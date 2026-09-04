// @ts-check

const NO_CHANGES = { operations: [] };

/**
 * Re-prices the protection line to a percentage of the cart subtotal, clamped
 * to a min/max. Runs on the purchase.cart-transform.run target, so it returns a
 * FunctionRunResult with an `update` operation. Configuration is read from the
 * `$app:kourify` / `fee_config` metafield the app writes for Plus/dev stores:
 *
 *   { "percentBasisPoints": 200, "minCents": 99, "maxCents": 199,
 *     "variantId": "gid://shopify/ProductVariant/123" }
 *
 * @param {any} input
 * @returns {any}
 */
export function run(input) {
  const raw = input?.cartTransform?.metafield?.jsonValue;
  if (!raw) return NO_CHANGES;

  const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
  const percentBasisPoints = Number(cfg?.percentBasisPoints);
  const variantId = cfg?.variantId;
  if (!variantId || !Number.isFinite(percentBasisPoints)) return NO_CHANGES;

  const lines = input?.cart?.lines ?? [];
  const protectionLine = lines.find((line) => {
    const m = line.merchandise;
    return m?.__typename === "ProductVariant" && m.id === variantId;
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
  let feeCents = Math.round((subtotalCents * percentBasisPoints) / 10000);
  const minCents = Number(cfg?.minCents);
  const maxCents = Number(cfg?.maxCents);
  if (Number.isFinite(minCents)) feeCents = Math.max(feeCents, minCents);
  if (Number.isFinite(maxCents)) feeCents = Math.min(feeCents, maxCents);
  if (!Number.isFinite(feeCents) || feeCents < 0) return NO_CHANGES;

  const amount = (feeCents / 100).toFixed(2);
  return {
    operations: [
      {
        update: {
          cartLineId: protectionLine.id,
          price: { adjustment: { fixedPricePerUnit: { amount } } },
        },
      },
    ],
  };
}
