// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/** @type {CartTransformRunResult} */
const NO_CHANGES = {
  operations: [],
};

/**
 * Re-prices the protection line to a percentage of the cart subtotal, clamped
 * to a min/max. Configuration is read from the `$app:kourify` / `fee_config`
 * metafield the app writes for Plus/dev stores:
 *
 *   { "percentBasisPoints": 200, "minCents": 99, "maxCents": 999,
 *     "variantId": "gid://shopify/ProductVariant/123" }
 *
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const raw = input.cartTransform?.metafield?.jsonValue;
  if (!raw) return NO_CHANGES;

  const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!cfg || !cfg.variantId || !cfg.percentBasisPoints) return NO_CHANGES;

  const lines = input.cart?.lines ?? [];
  const protectionLine = lines.find((line) => {
    const m = line.merchandise;
    return m.__typename === "ProductVariant" && m.id === cfg.variantId;
  });
  if (!protectionLine) return NO_CHANGES;

  // Subtotal (in cents) of every line except the protection line itself.
  let subtotalCents = 0;
  for (const line of lines) {
    if (line.id === protectionLine.id) continue;
    const perUnit = Number(line.cost?.amountPerQuantity?.amount ?? 0);
    const qty = Number(line.quantity ?? 0);
    subtotalCents += Math.round(perUnit * 100) * qty;
  }

  // percent of subtotal, clamped to [minCents, maxCents].
  let feeCents = Math.round((subtotalCents * cfg.percentBasisPoints) / 10000);
  if (Number.isFinite(cfg.minCents)) feeCents = Math.max(feeCents, cfg.minCents);
  if (Number.isFinite(cfg.maxCents)) feeCents = Math.min(feeCents, cfg.maxCents);
  if (feeCents < 0) feeCents = 0;

  const amount = (feeCents / 100).toFixed(2);
  return {
    operations: [
      {
        lineUpdate: {
          cartLineId: protectionLine.id,
          price: { adjustment: { fixedPricePerUnit: { amount } } },
        },
      },
    ],
  };
}
