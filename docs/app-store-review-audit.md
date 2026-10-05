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
| ✅ Likely passing | 29 |
| ❌ Likely failing | 1 |
| ⚠️ Needs review | 5 |
| ⏭️ Groups skipped | 8 |

**Changed since the first run.** 5.1.3 (theme-extension onboarding) was fixed
the same day — see "Fixed" below. 3.1.1 (TLS) is the only failure left, and it
is not fixable in this repo.

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

---

## ✅ Fixed since this audit was written

### 5.1.3 Include detailed onboarding instructions for theme app extensions

**What was wrong:** no deep link to the theme editor anywhere in `app/`, and a
dashboard setup guide that claimed the blocks were already placed. A merchant
who installed the app and never opened the theme editor saw nothing on their
storefront and was given no instruction that would change that. We hit this
ourselves on 2026-10-01: the test store's cart showed a hand-written copy of
the block for three weeks while the dashboard reported protection as live.

**What it is now:** `app/components/ThemeSetup.tsx` is a full onboarding panel,
first on the Help page. It names all six blocks by the exact name the theme
editor shows, says what a shopper sees and which template each one belongs on,
separates the app embed (one switch, every theme) from the app blocks (placed,
Online Store 2.0 only), explains adding, moving, configuring and removing, and
gives each one a documented deep link that opens the editor with the block
already added. The dashboard's step 2 no longer claims placement it cannot
check, and carries an "Add to theme" button for the product block.
`app/components/ThemeSetup.test.ts` pins every handle to a real block file and
every printed name to that block's own schema.

**Tested, not assumed.** All three link shapes were clicked against the live
oveelab admin on 2026-10-06. `context=apps&activateAppId=…` opened App embeds
with the guarantee tab already switched on — Shopify redirects it to its own
`?context=apps&appEmbed=…` form, which is the link working, not failing.
`target=mainSection` landed the product block inside Product information.
`target=newAppsSection` added the cart block to the cart template. One thing
the docs do not mention and the click did: a deep link adds a block without
checking for one, so clicking it on a theme that already has that block draws
it twice. The panel now says so.

**`read_themes` was added on 2026-10-06**, which closes the larger half of
what was still weak. `ThemeBlocks` in the backend reads the published theme's
`settings_data.json` and its product and cart templates, so the panel can show
which blocks are really there and switched on, warn before the buttons rather
than after when a theme is vintage, and stop the dashboard ticking a step
whose block is missing. A lookup that fails reports `known: false` and the app
claims nothing — "we could not check" and "you have not added it" are
different answers and only one is safe to act on.

**Still weak.** Two things, both narrow. The deep links target
`themes/current`, so a merchant who wants to try the blocks on an unpublished
theme does it by hand. And placement is only read from those three files, not
from section groups — a cart block placed in a drawer built as an `aside`
group reads as missing. Both report less than the truth rather than something
false, which is the right direction to be wrong in.

### Scopes narrowed in the same pass

**Why this matters for review:** "an app that asks for a scope it never
exercises is one review sends back" is the rule the September cull was done
under, and one scope had been left open ever since.

`write_orders` is gone, replaced by `read_orders` (2026-10-06). Every mutation
the backend sends was enumerated first: the only three that touch an order are
`orderEditBegin`, `orderEditAddCustomItem` and `orderEditCommit`, whose
requirement Shopify's schema gives as `write_order_edits, read_orders`. The
metafields the app writes belong to `currentAppInstallation`. Nothing writes
an order.

It ships in the same deploy as `read_themes` deliberately — a removal is
silent and an addition prompts, so the two additions cost one re-consent
rather than two. `app/shopify-config.test.ts` now pins the whole list, so the
next change has to be a deliberate edit in two places.

**Not yet proven on a store.** Order sync, a fulfillment and the offer flow
all have to run once without `write_orders` before launch.

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

## ✅ Likely passing (29)

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
