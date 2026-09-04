# Plus-tier percentage fee via Cart Transform

Goal: let **Plus / dev** stores charge a customer-facing protection fee that is a
**percentage of cart subtotal** (clamped to min/max) at checkout, instead of the
flat fixed-variant price. Non-Plus stores keep the flat variant, or use
merchant-pays (already supported via `protectionPayer = "merchant"`).

**Platform constraint (why this is Plus-only):** Cart Transform `lineUpdate`
price-override operations run **only on development stores and Shopify Plus**
(https://shopify.dev/docs/api/functions/2026-07/cart-transform). On other plans
the function is inert, so the flat variant must remain the fallback.

The function reads a per-shop config metafield and overrides the price of the
existing protection line — so the checkout still adds the same variant the
current flow adds; the function just re-prices it. Display == charge, because the
function runs server-side in checkout.

---

## 1. Scaffold the function (CLI — run on your machine)

```bash
shopify app generate extension \
  --template cart_transform \
  --flavor vanilla-js \
  --name kourify-dynamic-fee
```

This creates `extensions/kourify-dynamic-fee/` with `shopify.extension.toml`, a
generated `schema.graphql`, and starter `src/` files. Then replace the input
query and the run function with the two files below.

The target is `cart.transform.run`, export `cart_transform_run`.

## 2. Input query — `src/cart_transform_run.graphql`

> ✅ Validated against the `functions_cart_transform` schema (2026-07).

```graphql
query Input {
  cart {
    lines {
      id
      quantity
      cost {
        amountPerQuantity {
          amount
        }
      }
      merchandise {
        __typename
        ... on ProductVariant {
          id
        }
      }
    }
  }
  cartTransform {
    metafield(namespace: "$app:kourify", key: "fee_config") {
      jsonValue
    }
  }
}
```

## 3. Run function — `src/cart_transform_run.js`

Config JSON shape (written by the app in step 5):
`{ "percentBasisPoints": 200, "minCents": 99, "maxCents": 999, "variantId": "gid://shopify/ProductVariant/123" }`

```js
// @ts-check
const NO_CHANGES = { operations: [] };

/**
 * @param {any} input
 * @returns {{operations: any[]}}
 */
export function cartTransformRun(input) {
  const raw = input?.cartTransform?.metafield?.jsonValue;
  if (!raw) return NO_CHANGES;

  const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!cfg || !cfg.variantId || !cfg.percentBasisPoints) return NO_CHANGES;

  const lines = input?.cart?.lines ?? [];
  const protectionLine = lines.find(
    (l) =>
      l.merchandise?.__typename === "ProductVariant" &&
      l.merchandise.id === cfg.variantId,
  );
  if (!protectionLine) return NO_CHANGES;

  // Subtotal in cents = every line except the protection line itself.
  let subtotalCents = 0;
  for (const line of lines) {
    if (line.id === protectionLine.id) continue;
    const perUnit = Number(line.cost?.amountPerQuantity?.amount ?? 0);
    const qty = Number(line.quantity ?? 0);
    subtotalCents += Math.round(perUnit * 100) * qty;
  }

  // percent of subtotal, clamped to [min, max].
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
```

Build + test locally:

```bash
cd extensions/kourify-dynamic-fee
shopify app function build
shopify app function run --input=input.json --export=cart_transform_run
```

## 4. Plan detection (app side)

Add a `planTier` column to `MerchantSettings` (migration), and populate it after
auth. Query the shop's plan:

```graphql
query ShopPlan {
  shop {
    plan {
      displayName
      shopifyPlus
      partnerDevelopment
    }
  }
}
```

`shopifyPlus || partnerDevelopment` ⇒ the Cart Transform override will run. Store
`planTier` = `"plus"` | `"dev"` | `"standard"` on the settings row. Gate the whole
percentage-at-checkout path on this.

## 5. Write the config metafield + activate the function (app side)

When a Plus/dev merchant saves percentage pricing with protection enabled:

1. Write the config metafield the function reads (owner = the app, namespace
   `$app:kourify`, key `fee_config`, type `json`):

```graphql
mutation SetFeeConfig($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id }
    userErrors { field message }
  }
}
```
Owner id = the app installation / the cart-transform owner (see cartTransformCreate
result below); value = the JSON in step 3.

2. Activate the function once per shop (idempotent — store the returned id):

```graphql
mutation Activate($functionId: String!) {
  cartTransformCreate(functionId: $functionId, blockOnFailure: false) {
    cartTransform { id }
    userErrors { field message }
  }
}
```

`functionId` comes from `shopify app deploy` (the function's id in the Partner
dashboard / `shopifyFunctions` query). `blockOnFailure: false` means checkout is
never blocked if the function errors — the line keeps its variant price, so the
flat fallback holds.

Deactivate with `cartTransformDelete` when the merchant turns percentage pricing
off or downgrades from Plus.

## 6. Gating summary

| Condition | Behaviour |
|---|---|
| Plus/dev + `protectionFeeType = percent` + enabled | Activate Cart Transform; fee = % of subtotal (clamped) |
| Plus/dev + `protectionFeeType = flat` | No function; flat variant price (as today) |
| Standard plan, customer-pays | Flat variant only (percentage not offered — it can't run) |
| `protectionPayer = merchant` (any plan) | No customer fee; merchant-pays recording handles billing |

## 7. Admin UX

On the protection settings page, when the store is **not** Plus/dev, disable the
"percentage" fee-type option (or show a note) so a standard merchant can't pick a
mode that silently falls back to flat at checkout.

---

**Not done here / needs your environment:** scaffolding (`shopify app generate`),
`schema.graphql` generation, `function build`, `deploy`, and activation all need
the Shopify CLI authed to the Partner org and a Plus/dev test store. The input
query above is schema-validated; the run logic and mutations are written to spec
but were not compiled/deployed in this session.
