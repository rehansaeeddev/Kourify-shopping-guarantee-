import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cacheOrder } from "../lib/order-sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return new Response("Invalid payload", { status: 400 });
  }

  const data = body as Record<string, unknown>;

  // Extract order data from webhook payload
  const orderId = data.id as string;
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

    console.log(`✓ Cached new order ${orderName} (${orderId}) for shop ${shop}`);
  } catch (error) {
    console.error(`Failed to cache order ${orderId}:`, error);
    // Return 200 anyway so Shopify doesn't retry the webhook
  }

  return new Response();
};
