import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { PROTECTION_LINE_TITLE } from "../lib/protection-orders.server";
import {
  refundTouchesProtection,
  revokeProtection,
} from "../lib/protection-revocation.server";

/**
 * A refund only revokes coverage when the *protection* line itself is refunded.
 * Refunding a damaged product while keeping protection must leave coverage
 * intact — that is exactly the case protection exists for.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  if (!payload || typeof payload !== "object") {
    return new Response("Invalid payload", { status: 400 });
  }
  const data = payload as Record<string, unknown>;

  // Refund payloads reference the order by numeric id; protection rows are
  // keyed by the GraphQL GID used everywhere else.
  const orderNumericId = data.order_id != null ? String(data.order_id) : "";
  if (!orderNumericId) return new Response();
  const orderId = `gid://shopify/Order/${orderNumericId}`;

  try {
    const refundLineItems =
      (data.refund_line_items as Array<Record<string, unknown>>) ?? [];

    const touchesProtection = await refundTouchesProtection({
      shop,
      shopifyOrderId: orderId,
      refundLineItems,
      protectionTitle: PROTECTION_LINE_TITLE,
    });

    if (!touchesProtection) return new Response();

    const result = await revokeProtection({
      shop,
      shopifyOrderId: orderId,
      reason: "protection_refunded",
    });

    if (result.revoked) {
      console.log(
        `[kourify] Protection revoked for ${orderId} (refunded). Usage reversed: ${result.usageReversed}, already billed: ${result.usageAlreadyBilled}`,
      );
    }
  } catch (error) {
    console.error(`[kourify] refunds/create failed for ${orderId}:`, error);
    // 200 regardless so Shopify doesn't retry a non-transient failure.
  }

  return new Response();
};
