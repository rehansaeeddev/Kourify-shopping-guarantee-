import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cacheOrder } from "../lib/order-sync.server";
import { recordProtectionSelection } from "../lib/protection-orders.server";
import { billUsageEvent } from "../lib/usage-billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);

  if (!payload || typeof payload !== "object") {
    return new Response("Invalid payload", { status: 400 });
  }

  const data = payload as Record<string, unknown>;

  // Extract order data from webhook payload — the DB stores the GraphQL GID
  // (matches recordProtectionSelection's id shape), not the REST payload's
  // plain numeric `id`.
  const orderId = String(data.admin_graphql_api_id ?? data.id ?? "");
  const orderName = data.name as string;
  const orderEmail = ((data.email as string) ?? ((data.contact as Record<string, unknown>)?.email as string) ?? "") as string;
  const totalPrice = (data.total_price as string | null) ?? null;

  try {
    await cacheOrder(shop, {
      id: orderId,
      name: orderName,
      email: orderEmail,
      status: "pending",
      riskLevel: null,
      shippedAt: null, // Will be set when fulfillment is created
      totalPrice,
    });
    const usageEvent = await recordProtectionSelection(shop, data);
    if (usageEvent?.status === "pending" && admin) {
      await billUsageEvent(usageEvent.id, admin);
    }

    console.log(`✓ Cached new order ${orderName} (${orderId}) for shop ${shop}`);
  } catch (error) {
    console.error(`Failed to cache order ${orderId}:`, error);
    // Return 200 anyway so Shopify doesn't retry the webhook
  }

  return new Response();
};
