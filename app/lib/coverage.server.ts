import db from "../db.server";

/**
 * Coverage rules for item-level protection.
 *
 * Two concepts are kept deliberately apart:
 *
 *  - **Protection price** — what the shopper pays (or the merchant absorbs) for
 *    protection. Configured by the pricing settings.
 *  - **Covered merchandise value** — the value of goods that may be protected,
 *    bounded by the merchant's eligibility ceiling.
 *
 * They are never derived from one another. A $2.99 protection fee says nothing
 * about how much merchandise is covered.
 *
 * No monetary threshold is hardcoded here. `maxEligibleItemValueCents` is the
 * only ceiling, it comes from merchant settings, and `null` means the merchant
 * has configured none — in which case every item is eligible.
 */

/** A merchandise line as it appears on a Shopify order webhook payload. */
export type OrderLine = {
  id?: string | number;
  title?: string;
  quantity?: number;
  /** Per-unit price as a decimal string, excluding tax and shipping. */
  price?: string;
  variant_id?: string | number | null;
  sku?: string | null;
  properties?: Array<{ name?: string; value?: string }> | Record<string, string>;
};

export type EligibleLine = {
  lineItemId: string;
  title: string;
  variantId: string | null;
  sku: string | null;
  quantity: number;
  unitPriceCents: number;
  eligible: boolean;
};

/**
 * Is a single unit of merchandise within the merchant's eligibility ceiling?
 *
 * The ceiling is compared against the **unit** price, matching the merchant-facing
 * wording ("maximum item value"): a $750 item is ineligible even when bought
 * alongside cheaper items, and ten $50 items stay eligible.
 */
export function isItemEligible(
  unitPriceCents: number,
  maxEligibleItemValueCents: number | null | undefined,
): boolean {
  // No ceiling configured → nothing to exclude.
  if (maxEligibleItemValueCents == null) return true;
  if (maxEligibleItemValueCents <= 0) return true;
  // At the threshold is eligible: a $500 item passes a $500 ceiling.
  return unitPriceCents <= maxEligibleItemValueCents;
}

function parseUnitPriceCents(price: unknown): number {
  const value = Number(price ?? 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

/**
 * Turns an order's line items into coverage rows, skipping the protection line
 * itself (protection is not merchandise and cannot be claimed against).
 *
 * Shipping and tax never appear here: Shopify keeps them off `line_items`, and
 * `price` is the pre-tax unit amount, so the covered value is merchandise-only
 * by construction rather than by subtraction.
 */
export function buildCoverageLines(
  lines: OrderLine[],
  isProtectionLine: (line: OrderLine) => boolean,
  maxEligibleItemValueCents: number | null | undefined,
): EligibleLine[] {
  return lines
    .filter((line) => !isProtectionLine(line))
    .map((line) => {
      const unitPriceCents = parseUnitPriceCents(line.price);
      return {
        lineItemId: String(line.id ?? ""),
        title: String(line.title ?? "Item"),
        variantId: line.variant_id != null ? String(line.variant_id) : null,
        sku: line.sku ? String(line.sku) : null,
        quantity: Math.max(1, Math.floor(Number(line.quantity ?? 1))),
        unitPriceCents,
        eligible: isItemEligible(unitPriceCents, maxEligibleItemValueCents),
      };
    })
    .filter((line) => Boolean(line.lineItemId));
}

/** Merchandise value that is actually covered — eligible lines only. */
export function coveredMerchandiseCents(lines: EligibleLine[]): number {
  return lines
    .filter((line) => line.eligible)
    .reduce((total, line) => total + line.unitPriceCents * line.quantity, 0);
}

export type LossAssessment =
  | { ok: true; claimedQuantity: number; itemValueCents: number; eligibleLossCents: number }
  | { ok: false; reason: string };

/**
 * Ceiling on what a merchant could approve for one claim against one item.
 *
 * Deducts quantity already settled on the same item, so repeat claims cannot
 * accumulate past the item's own value. This bounds exposure; it does not
 * approve anything — the merchant still decides, and may approve less.
 */
export async function assessEligibleLoss(params: {
  shop: string;
  protectedItemId: string;
  requestedQuantity: number;
}): Promise<LossAssessment> {
  const item = await db.protectedOrderItem.findFirst({
    where: { id: params.protectedItemId, shop: params.shop },
  });
  if (!item) return { ok: false, reason: "ITEM_NOT_FOUND" };
  if (!item.eligible) return { ok: false, reason: "ITEM_NOT_ELIGIBLE" };

  const requested = Math.floor(params.requestedQuantity);
  if (!Number.isFinite(requested) || requested < 1) {
    return { ok: false, reason: "QUANTITY_INVALID" };
  }
  if (requested > item.quantity) return { ok: false, reason: "QUANTITY_EXCEEDS_ORDERED" };

  // Quantity locked up by claims that are still open or already approved.
  // Denied claims release their quantity back.
  const priorClaims = await db.protectionClaim.findMany({
    where: {
      shop: params.shop,
      protectedItemId: item.id,
      status: { in: ["submitted", "reviewing", "resolved"] },
    },
    select: { claimedQuantity: true },
  });
  const alreadyClaimed = priorClaims.reduce(
    (total, claim) => total + (claim.claimedQuantity ?? 0),
    0,
  );
  const remaining = item.quantity - alreadyClaimed;
  if (remaining <= 0) return { ok: false, reason: "ALREADY_FULLY_CLAIMED" };
  if (requested > remaining) return { ok: false, reason: "QUANTITY_EXCEEDS_REMAINING" };

  return {
    ok: true,
    claimedQuantity: requested,
    itemValueCents: item.unitPriceCents,
    eligibleLossCents: item.unitPriceCents * requested,
  };
}

export const LOSS_ERROR_MESSAGES: Record<string, string> = {
  ITEM_NOT_FOUND: "We couldn't find that item on your protected order.",
  ITEM_NOT_ELIGIBLE:
    "That item's value is above the maximum this store protects, so it isn't covered.",
  QUANTITY_INVALID: "Choose how many units were affected.",
  QUANTITY_EXCEEDS_ORDERED:
    "That's more units than were on the order. Please check the quantity.",
  ALREADY_FULLY_CLAIMED:
    "Every unit of that item is already covered by an existing claim.",
  QUANTITY_EXCEEDS_REMAINING:
    "Some units of that item are already covered by an existing claim. Please lower the quantity.",
};
