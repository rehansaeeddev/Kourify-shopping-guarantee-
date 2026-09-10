import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { revokeProtection } from "../lib/protection-revocation.server";

/**
 * A cancelled order has no delivery to protect, so coverage is revoked
 * wholesale and any not-yet-billed usage fee is reversed with it.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  if (!payload || typeof payload !== "object") {
    return new Response("Invalid payload", { status: 400 });
  }
  const data = payload as Record<string, unknown>;

  const orderId = String(data.admin_graphql_api_id ?? data.id ?? "");
  if (!orderId) return new Response();

  try {
    const result = await revokeProtection({
      shop,
      shopifyOrderId: orderId,
      reason: "order_cancelled",
    });
    if (result.revoked) {
      console.log(
        `[kourify] Protection revoked for ${orderId} (cancelled). Usage reversed: ${result.usageReversed}, already billed: ${result.usageAlreadyBilled}`,
      );
    }
  } catch (error) {
    console.error(`[kourify] orders/cancelled failed for ${orderId}:`, error);
  }

  return new Response();
};
