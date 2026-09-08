import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ingestBulkOperationFinish } from "../lib/order-bulk-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);

  if (!payload || typeof payload !== "object" || !admin) {
    // No admin client means the shop is no longer installed — nothing to
    // ingest for it.
    return new Response();
  }

  const data = payload as Record<string, unknown>;
  const bulkOperationId = String(data.admin_graphql_api_id ?? "");
  if (!bulkOperationId) {
    return new Response("Missing bulk operation id", { status: 400 });
  }

  try {
    await ingestBulkOperationFinish(shop, admin, bulkOperationId);
  } catch (error) {
    console.error(
      `Failed to ingest bulk operation ${bulkOperationId} for ${shop}:`,
      error,
    );
    // Return 200 anyway so Shopify doesn't retry the webhook.
  }

  return new Response();
};
