import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { AppButton } from "../components/AppButton";
import { Card, StatTile } from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import { useFetcherToast } from "../hooks/useFetcherToast";
import db from "../db.server";
import { cacheOrder } from "../lib/order-sync.server";
import { riskLevelFromRecommendation } from "../lib/order-risk";
import { authenticate } from "../shopify.server";

type SyncResult = {
  ok: boolean;
  synced?: number;
  error?: string;
};

type OrderSyncEdge = {
  cursor: string;
  node: {
    id: string;
    name: string;
    displayFulfillmentStatus?: string | null;
    email?: string | null;
    risk?: { recommendation?: string | null } | null;
    totalPriceSet?: { shopMoney?: { amount?: string | null } | null } | null;
    fulfillments?: Array<{ createdAt?: string | null }> | null;
  };
};

type OrderSyncConnection = {
  edges?: OrderSyncEdge[];
  pageInfo?: { hasNextPage?: boolean };
};

type OrderSyncGraphqlResult = {
  data?: {
    orders?: OrderSyncConnection;
  };
  errors?: Array<{ message?: string }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const [orderCount, latestOrder] = await Promise.all([
    db.order.count({ where: { shop: session.shop } }),
    db.order.findFirst({
      where: { shop: session.shop },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  return {
    orderCount,
    lastUpdatedAt: latestOrder?.updatedAt.toISOString() ?? null,
    orderSyncEnabled: process.env.ORDER_SYNC_ENABLED === "true",
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<SyncResult> => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (process.env.ORDER_SYNC_ENABLED !== "true") {
    return {
      ok: false,
      error:
        "Order sync requires Shopify approval for protected customer data.",
    };
  }

  if (formData.get("intent") !== "sync") {
    return { ok: false, error: "Unknown action." };
  }

  let cursor: string | null = null;
  let hasNextPage = true;
  let synced = 0;

  try {
    while (hasNextPage) {
      const response: Response = await admin.graphql(
        `#graphql
          query kourifySyncOrders($cursor: String) {
            orders(first: 100, after: $cursor, sortKey: UPDATED_AT) {
              edges {
                cursor
                node {
                  id
                  name
                  displayFulfillmentStatus
                  email
                  risk { recommendation }
                  totalPriceSet { shopMoney { amount } }
                  fulfillments(first: 10) { createdAt }
                }
              }
              pageInfo { hasNextPage }
            }
          }`,
        { variables: { cursor } },
      );

      const json = (await response.json()) as OrderSyncGraphqlResult;
      if (json.errors?.length) {
        throw new Error(
          json.errors[0]?.message ?? "Shopify could not return orders.",
        );
      }

      const connection: OrderSyncConnection = json.data?.orders ?? {
        edges: [],
        pageInfo: { hasNextPage: false },
      };
      const edges: OrderSyncEdge[] = connection.edges ?? [];

      for (const { node } of edges) {
        const fulfillments = node.fulfillments ?? [];
        const shippedAt =
          fulfillments
            .map((fulfillment) => fulfillment.createdAt)
            .filter((createdAt): createdAt is string => Boolean(createdAt))
            .sort()
            .at(-1) ?? null;

        await cacheOrder(session.shop, {
          id: node.id,
          name: node.name,
          email: node.email ?? "",
          // customerName requires Protected Customer Data approval; omitted until granted.
          customerName: null,
          status: String(
            node.displayFulfillmentStatus ?? "unfulfilled",
          ).toLowerCase(),
          riskLevel: riskLevelFromRecommendation(node.risk?.recommendation),
          shippedAt,
          totalPrice: node.totalPriceSet?.shopMoney?.amount ?? null,
        });
        synced += 1;
      }

      hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
      cursor = edges.at(-1)?.cursor ?? null;
      if (hasNextPage && !cursor) {
        throw new Error("Shopify returned an incomplete pagination response.");
      }
    }

    return { ok: true, synced };
  } catch (error) {
    console.error("Order sync failed:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Order sync failed.",
    };
  }
};

export default function OrderSync() {
  const { orderCount, lastUpdatedAt, orderSyncEnabled } =
    useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<SyncResult>();
  const syncing = syncFetcher.state !== "idle";

  useFetcherToast(syncFetcher, (data) =>
    data.ok
      ? `${data.synced ?? 0} orders synchronized.`
      : (data.error ?? "Order sync failed."),
  );

  const lastUpdated = lastUpdatedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(lastUpdatedAt))
    : "Never";

  return (
    <s-page>
      <PageHeader
        title="Order sync"
        subtitle="Keep the order cache used for claim verification up to date."
        actions={
          <AppButton href="/app" variant="secondary">
            Back to home
          </AppButton>
        }
      />

      <Card heading="Sync status">
        <div className="app-card-row">
          <StatTile
            icon="check-circle"
            label="Sync mode"
            tone="warning"
            value={orderSyncEnabled ? "Manual" : "Approval required"}
          />
          <StatTile
            icon="order"
            label="Cached orders"
            value={String(
              syncFetcher.data?.ok ? syncFetcher.data.synced : orderCount,
            )}
          />
          <StatTile
            icon="clock"
            label="Last cache update"
            value={lastUpdated}
          />
        </div>
      </Card>

      <Card heading="Manual synchronization">
        <s-stack gap="base">
          {!orderSyncEnabled ? (
            <s-banner heading="Protected Order access required" tone="warning">
              Shopify is currently blocking this app from accessing orders.
              Request protected customer data access in the Partner Dashboard,
              then set ORDER_SYNC_ENABLED=true and restart the app.
            </s-banner>
          ) : (
            <s-paragraph>
              Import available existing orders now. Automatic order webhooks
              remain off, so use this button whenever orders change.
            </s-paragraph>
          )}
          {syncFetcher.data && !syncFetcher.data.ok ? (
            <s-banner tone="critical">{syncFetcher.data.error}</s-banner>
          ) : null}
          <syncFetcher.Form method="post">
            <input type="hidden" name="intent" value="sync" />
            <AppButton
              type="submit"
              variant="primary"
              disabled={syncing || !orderSyncEnabled}
            >
              {!orderSyncEnabled
                ? "Order access required"
                : syncing
                  ? "Syncing orders…"
                  : "Sync orders now"}
            </AppButton>
          </syncFetcher.Form>
        </s-stack>
      </Card>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
