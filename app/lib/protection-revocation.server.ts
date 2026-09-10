import db from "../db.server";

/**
 * Reversing a protection purchase.
 *
 * Coverage is *revoked*, never deleted: the row and its items stay so an
 * existing claim keeps its evidence trail and the history remains auditable.
 * Claim submission checks `revokedAt`, so revoked coverage stops authorising
 * new claims immediately.
 *
 * Usage billing is reversed alongside it, but only where that is still
 * possible. A `pending` event has not been sent to Shopify yet and is simply
 * marked `reversed`. An event already `billed` carries a real Shopify usage
 * record; this app has no credit path for those, so it is left untouched
 * rather than silently misreported as reversed.
 */
export type RevocationReason =
  | "protection_refunded"
  | "order_cancelled"
  | "order_refunded";

export async function revokeProtection(params: {
  shop: string;
  shopifyOrderId: string;
  reason: RevocationReason;
}): Promise<{ revoked: boolean; usageReversed: number; usageAlreadyBilled: number }> {
  const protectedOrder = await db.protectedOrder.findUnique({
    where: {
      shop_shopifyOrderId: {
        shop: params.shop,
        shopifyOrderId: params.shopifyOrderId,
      },
    },
    include: { usageEvents: true },
  });

  if (!protectedOrder) {
    return { revoked: false, usageReversed: 0, usageAlreadyBilled: 0 };
  }
  if (protectedOrder.revokedAt) {
    // Already revoked — keep the original reason and timestamp.
    return { revoked: false, usageReversed: 0, usageAlreadyBilled: 0 };
  }

  await db.protectedOrder.update({
    where: { id: protectedOrder.id },
    data: { revokedAt: new Date(), revokedReason: params.reason },
  });

  const reversible = protectedOrder.usageEvents.filter(
    (event) => event.status === "pending",
  );
  const alreadyBilled = protectedOrder.usageEvents.filter(
    (event) => event.status === "billed",
  );

  if (reversible.length) {
    await db.usageEvent.updateMany({
      where: { id: { in: reversible.map((event) => event.id) } },
      data: { status: "reversed" },
    });
  }

  return {
    revoked: true,
    usageReversed: reversible.length,
    usageAlreadyBilled: alreadyBilled.length,
  };
}

/**
 * Was the protection line specifically refunded on this order?
 *
 * A `refunds/create` payload lists the refunded line items; protection is
 * matched the same way it is recognised at purchase — the shop's configured
 * variant, or a variant-less line with the protection title where the shop
 * actually issued an offer for this order.
 */
export async function refundTouchesProtection(params: {
  shop: string;
  shopifyOrderId: string;
  refundLineItems: Array<Record<string, unknown>>;
  protectionTitle: string;
}): Promise<boolean> {
  const settings = await db.merchantSettings.findUnique({
    where: { shop: params.shop },
    select: { protectionVariantId: true },
  });
  const configuredLegacy = settings?.protectionVariantId?.split("/").pop() ?? null;

  const hasOffer = configuredLegacy
    ? null
    : await db.protectionOffer.findFirst({
        where: {
          shop: params.shop,
          originalOrderId: params.shopifyOrderId,
          status: { in: ["awaiting_payment", "payment_confirmed"] },
        },
        select: { id: true },
      });

  return params.refundLineItems.some((entry) => {
    const line = (entry.line_item ?? entry) as Record<string, unknown>;
    const variantId = line.variant_id != null ? String(line.variant_id) : null;
    if (configuredLegacy && variantId === configuredLegacy) return true;
    if (hasOffer && !variantId && line.title === params.protectionTitle) {
      return true;
    }
    return false;
  });
}
