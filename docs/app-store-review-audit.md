# App Store review: local self-audit

**Run:** 2026-10-05, against the live requirement list fetched with
`shopify doc fetch` from
`shopify.dev/docs/apps/launch/app-store-review/app-store-ai-self-review-requirements`.

This covers only the requirements Shopify marks as checkable against a local
codebase. Shopify reviews these **and more** at submission. It is not a
substitute for that review.

## Summary

| | |
|---|---|
| ✅ Likely passing | 28 |
| ❌ Likely failing | 2 |
| ⚠️ Needs review | 5 |
| ⏭️ Groups skipped | 8 |

---

## ❌ Likely failing

### 3.1.1 Use a valid TLS/SSL certificate

**Why this matters:** Everything between the merchant's browser and the app
must be encrypted, and Shopify checks the certificate at submission.

**What was found:** `shopify.app.toml` still carries the placeholder
`application_url = "https://example.com"` and `app_proxy.url =
"https://example.com/proxy"`. There is no origin to hold a certificate. The
app currently only runs behind an ephemeral `trycloudflare.com` tunnel raised
by `shopify app dev`, which dies with the session and takes a new hostname
every time. This is the same blocker as launching at all.

### 5.1.3 Include detailed onboarding instructions for theme app extensions

**Why this matters:** The app's whole storefront presence — the guarantee tab,
the product badge, the cart block — only appears once a merchant places an app
block or enables the app embed. Nothing in the app tells them how.

**What was found:** No deep link to the theme editor anywhere in `app/`
(searched for `/admin/themes`, `editor?context=apps`, `activateAppId`). The
dashboard's setup guide (`app/routes/app._index.tsx:96`) assumes the blocks are
already placed — *"Customize copy and price from the theme editor blocks"* —
and the only other mention is one FAQ line on the Help page. A merchant who
installs the app and never opens the theme editor sees nothing on their
storefront and is given no instruction that would change that.

**Worth knowing:** we hit exactly this failure ourselves on 2026-10-01. The
cart drawer showed a hand-written copy of the block rather than the real one
for weeks, and nobody noticed because nothing in the app says what should be
where.

---

## ⚠️ Needs review

### 1.1.4 Use only factual information · 1.1.9 Obtain explicit buyer consent

**Why this needs attention:** Both hinge on the same detail, and it is a
judgement call rather than a clear breach.

**What was detected:** The cart block renders
`block.settings.preview_price_cents` — a figure the merchant types into the
theme editor — as the protection price in Liquid, *before* the app proxy
answers. `kourify-protection.js` then corrects it from real settings. On a
merchant-pays store a shopper can see "$2.99" for a moment before it becomes
"Included"; we watched that happen on 2026-10-05. The fee itself is opt-in
everywhere (an unchecked `s-checkbox` at checkout, an unchecked
`data-kourify-opt-in` in the theme block), so consent is sound — but a price
that is not the real price, shown to a buyer at any point, is the kind of
thing review asks about. Consider rendering no price until settings arrive.

### 1.2.2 Implement the Billing API correctly

**Why this needs attention:** The accept path is clearly right; the decline
path cannot be confirmed from code alone.

**What was detected:** `app/Services/Billing.php` uses
`appSubscriptionCreate` with a `returnUrl` and hands back
`confirmationUrl` — the correct flow. What is not visible in code is what a
merchant sees when they *decline* on Shopify's confirmation page, or whether
re-subscribing after an uninstall/reinstall works end to end. Both need a
real run on a dev store.

### 2.3.2 / 2.3.3 / 2.3.4 OAuth on install, reinstall, and the redirect after

**Why this needs attention:** The app deliberately has no OAuth callback, and
that is current and correct — but it cannot be traced from code the way the
requirement's guidance expects.

**What was detected:** `VerifyShopifySession` does token exchange from the App
Bridge `id_token` (`app/Http/Middleware/VerifyShopifySession.php:65`), which is
Shopify's own recommendation and avoids a callback entirely. The reinstall case
depends on `SessionStore::exchange` updating an existing shop row rather than
failing on a duplicate; that looked right on reading but was not exercised.
Worth one real install → uninstall → reinstall on a dev store.

### 5.6.3 Don't display self-promotion in checkout extensions

**Why this needs attention:** The app's own name appears at checkout, and
whether that reads as self-promotion is a reviewer's call.

**What was detected:** The checkout extension's label is
`Add {name} protection — {price}`, which uses the merchant's brand where one
is set (added 2026-10-01) and falls back to "Kourify" where it is not. The
catalogue product behind it is likewise `{shop} Order Protection` or
`Kourify Order Protection`. On an unbranded shop the app's name is visible to
buyers. It names a product the merchant sells rather than promoting the app,
which is the defensible reading — but a reviewer may see it differently.

---

## ✅ Likely passing (28)

Checked and found in order: session-token authentication with App Bridge from
Shopify's CDN and no cookie or `localStorage` session; Shopify checkout only;
no theme downloads; no marketplace, lending, POS, agency or payment-gateway
functionality; shipping options untouched; refunds only read from the
`refunds/create` webhook, never issued; Billing API rather than off-platform
charges, with upgrade and downgrade handled in-app; GraphQL Admin API
throughout and no REST call anywhere in `app/`; no admin UI extensions and no
Max modal; no field anywhere asking for a `.myshopify.com` domain; none of the
restricted scopes (`read_all_orders`, `write_payment_mandate`,
`write_checkout_extensions_apis`, `read_advanced_dom_pixel_events`,
`read_checkout_extensions_chat`); theme app extensions with no Asset API,
ScriptTag or theme write of any kind; claim data surfaced in the app's own UI;
and a checkout extension with no countdown, no promotional content and no
field that asks a buyer for payment details.

The three mandatory privacy webhooks are routed and handled
(`routes/shopify.php:42-44`).

---

## ⏭️ Groups skipped

| Group | Why |
|---|---|
| 5.2 Payment | No payment extension, no `write_payment_gateway` |
| 5.3 Payment facilitator | Opt-in only |
| 5.4 Purchase option | No subscription or payment-mandate scopes |
| 5.5 Product sourcing | Opt-in only |
| 5.7 Sales channel | No `channel_config` extension |
| 5.8 Post-purchase | No `checkout_post_purchase` extension |
| 5.9 Mobile app builders | Opt-in only |
| 5.10 Donation | Opt-in only |

Ask if any of these should be evaluated anyway.

---

## Not checkable here

Everything about the **listing** — screenshots, description, pricing copy,
privacy policy, support contact, demo store — is judged at submission and
none of it lives in this repo.

## Resources

- [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
- [Best practices for apps](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices)
- [About billing for your app](https://shopify.dev/docs/apps/launch/billing)
- [Submitting your app for review](https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review)
