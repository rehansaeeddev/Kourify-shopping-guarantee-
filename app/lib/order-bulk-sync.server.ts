import db from "../db.server";
import { cacheOrder } from "./order-sync.server";
import { riskLevelFromRecommendation } from "./order-risk";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown>; signal?: AbortSignal },
  ) => Promise<Response>;
};

/**
 * Order backfill for stores with too many orders to paginate inline in a
 * request (a 7,000-order store would need ~70 sequential GraphQL calls and
 * thousands of DB writes — well past any request timeout). Shopify's Bulk
 * Operations API builds the export server-side; we submit the query, then
 * the bulk_operations/finish webhook (see
 * app/routes/webhooks.bulk_operations.finish.tsx) tells us when the result
 * file is ready to ingest. Progress lives in the SyncJob table so the UI can
 * show queued/running/completed/failed without polling Shopify directly.
 */

const BULK_ORDERS_QUERY = `
{
  orders {
    edges {
      node {
        id
        name
        email
        createdAt
        displayFulfillmentStatus
        risk { recommendation }
        totalPriceSet { shopMoney { amount } }
        fulfillments {
          createdAt
        }
      }
    }
  }
}
`.trim();

export type SyncJobRecord = Awaited<ReturnType<typeof db.syncJob.findFirst>>;

/**
 * Starts a bulk order backfill for a shop, unless one is already in flight.
 * Only one bulk operation can run per shop at a time on Shopify's side, so we
 * also treat any queued/running SyncJob row as a reason to skip rather than
 * submit a second one.
 */
export async function startOrderBulkSync(
  shop: string,
  admin: AdminGraphqlClient,
): Promise<{ ok: true; job: SyncJobRecord } | { ok: false; error: string }> {
  const inFlight = await db.syncJob.findFirst({
    where: { shop, type: "order_backfill", status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  });
  if (inFlight) {
    return { ok: false, error: "An order sync is already running." };
  }

  const job = await db.syncJob.create({
    data: { shop, type: "order_backfill", status: "queued" },
  });

  try {
    const response = await admin.graphql(
      `#graphql
        mutation kourifyBulkOrdersBackfill($query: String!) {
          bulkOperationRunQuery(query: $query) {
            bulkOperation { id status }
            userErrors { field message }
          }
        }`,
      { variables: { query: BULK_ORDERS_QUERY } },
    );
    const json = await response.json();
    const result = json?.data?.bulkOperationRunQuery;
    const userError = result?.userErrors?.[0]?.message;
    if (userError) {
      await db.syncJob.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: userError, finishedAt: new Date() },
      });
      return { ok: false, error: userError };
    }

    const bulkOperationId = result?.bulkOperation?.id;
    if (!bulkOperationId) {
      const message = "Shopify did not return a bulk operation.";
      await db.syncJob.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: message, finishedAt: new Date() },
      });
      return { ok: false, error: message };
    }

    const updated = await db.syncJob.update({
      where: { id: job.id },
      data: { status: "running", bulkOperationId, startedAt: new Date() },
    });
    return { ok: true, job: updated };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start order sync.";
    await db.syncJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: message, finishedAt: new Date() },
    });
    return { ok: false, error: message };
  }
}

type BulkOperationNode = {
  status?: string;
  errorCode?: string | null;
  objectCount?: string | null;
  url?: string | null;
};

/**
 * Called from the bulk_operations/finish webhook once Shopify has built the
 * result file (or failed to). Downloads the JSONL export and ingests it.
 */
export async function ingestBulkOperationFinish(
  shop: string,
  admin: AdminGraphqlClient,
  bulkOperationId: string,
): Promise<void> {
  const job = await db.syncJob.findFirst({
    where: { shop, bulkOperationId },
  });
  if (!job) {
    // Not one of ours (or the row was already cleaned up) — nothing to do.
    return;
  }

  try {
    const response = await admin.graphql(
      `#graphql
        query kourifyBulkOperationStatus($id: ID!) {
          node(id: $id) {
            ... on BulkOperation {
              status
              errorCode
              objectCount
              url
            }
          }
        }`,
      { variables: { id: bulkOperationId } },
    );
    const json = await response.json();
    const node: BulkOperationNode | undefined = json?.data?.node;

    if (!node || node.status !== "COMPLETED") {
      await db.syncJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorMessage: node?.errorCode
            ? `Bulk operation failed: ${node.errorCode}`
            : "Bulk operation did not complete.",
          finishedAt: new Date(),
        },
      });
      return;
    }

    if (!node.url) {
      // No orders matched the query — an empty result is still a success.
      await db.syncJob.update({
        where: { id: job.id },
        data: { status: "completed", objectCount: 0, finishedAt: new Date() },
      });
      return;
    }

    const fileResponse = await fetch(node.url);
    if (!fileResponse.ok) {
      throw new Error(
        `Could not download bulk operation result (HTTP ${fileResponse.status}).`,
      );
    }
    const text = await fileResponse.text();
    const synced = await ingestOrdersJsonl(shop, text);

    await db.syncJob.update({
      where: { id: job.id },
      data: { status: "completed", objectCount: synced, finishedAt: new Date() },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to ingest order sync.";
    await db.syncJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: message, finishedAt: new Date() },
    });
  }
}

type JsonlOrderRow = {
  id?: string;
  name?: string;
  email?: string | null;
  /** The order's own creation time in Shopify — when it was placed. */
  createdAt?: string | null;
  displayFulfillmentStatus?: string | null;
  risk?: { recommendation?: string | null } | null;
  totalPriceSet?: { shopMoney?: { amount?: string | null } | null } | null;
  fulfillments?: Array<{ createdAt?: string | null }> | null;
};

/**
 * Parses a bulk-operation JSONL export and upserts each order. `fulfillments`
 * is a plain list field (not a GraphQL connection), so Shopify embeds it
 * inline as an array on the order's own line rather than emitting separate
 * __parentId-linked rows — each line here is a complete order.
 */
async function ingestOrdersJsonl(shop: string, text: string): Promise<number> {
  let synced = 0;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let row: JsonlOrderRow;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue; // skip a malformed line rather than aborting the whole import
    }
    if (!row.id) continue;

    const shippedAt =
      (row.fulfillments ?? [])
        .map((fulfillment) => fulfillment.createdAt)
        .filter((createdAt): createdAt is string => Boolean(createdAt))
        .sort()
        .at(-1) ?? null;

    await cacheOrder(shop, {
      id: row.id,
      name: row.name ?? "",
      email: row.email ?? "",
      status: String(row.displayFulfillmentStatus ?? "unfulfilled").toLowerCase(),
      riskLevel: riskLevelFromRecommendation(row.risk?.recommendation),
      shippedAt,
      placedAt: row.createdAt ?? null,
      totalPrice: row.totalPriceSet?.shopMoney?.amount ?? null,
    });
    synced += 1;
  }

  return synced;
}
