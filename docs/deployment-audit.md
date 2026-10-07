# Deployment and handover audit

**Run:** 2026-10-07, against both repos at `055a0c0` (frontend) and `d85173e`
(backend), ahead of moving the project to a company repository and deploying
from it.

**Covers both repos.** The project is two sibling checkouts that are built into
one deployable artifact, so auditing either alone misses the seam between them.

**Method.** Every finding below was produced by running something, not by
reading alone. Commands are given so each one can be re-checked. Where a
finding is conditional on the hosting environment, that condition is stated
rather than assumed away.

## Summary

| | |
|---|---|
| 🔴 Blocks deployment | 3 |
| 🟠 Fix before merchants | 4 |
| 🟡 Handover gaps | 8 |
| ✅ Checked and passing | 11 |

Nothing here is a secret leak. That was the first thing checked and both
histories are clean — see "Checked and passing".

---

## 🔴 Blocks deployment

### 1. There is no origin to deploy to

`shopify.app.toml` still carries placeholders in all three places that need a
real host:

```
application_url      = "https://example.com"
auth.redirect_urls   = [ "https://example.com/app" ]
app_proxy.url        = "https://example.com/proxy"
```

Nothing merchant-facing works until these point at a real HTTPS origin: the
embedded admin, the app proxy that serves the claim page, and every webhook.
This is also the one remaining ❌ in `docs/app-store-review-audit.md` (3.1.1,
TLS certificate).

**Needed:** a host for the Laravel app with a valid certificate, then these
three values and `SHOPIFY_APP_URL` in the backend `.env` updated to match, then
`shopify app deploy`.

### 2. Shopify access tokens are stored in plaintext

`app/Models/Session.php` hides `accessToken` and `refreshToken` from
serialisation but does not encrypt them at rest:

```php
protected $hidden = ['accessToken', 'refreshToken'];

protected function casts(): array
{
    return [
        'isOnline' => 'boolean',
        // ... no 'accessToken' => 'encrypted'
    ];
}
```

These are offline Admin API tokens. Anyone who can read the `Session` table —
a database dump, a backup on a developer's laptop, a read-only analytics user,
a managed-hosting support engineer — gets full API access to every installed
store at the app's granted scopes: read orders, read customers, write products,
write fulfillments, edit orders.

`$hidden` does not help here. It only stops the value appearing in JSON; the
column is still plaintext.

**Confirmed, not inferred.** Two checks:

- No write-time encryption exists. `Crypt::`, `encrypt(`, `encryptString` and
  `decryptString` appear nowhere in `app/`.
- The stored value was read back raw and begins `shpat_` — a Shopify access
  token in the clear. A Laravel-encrypted column would begin `eyJpdi`.

**The obvious fix does not work on its own.** Adding `'accessToken' =>
'encrypted'` to the casts would start truncating tokens, because the columns
are too narrow for a ciphertext:

```php
// database/migrations/2026_09_29_000000_create_kourify_schema.php
$table->string('accessToken', 191);
$table->string('refreshToken', 191)->nullable();
```

Laravel's encrypted payload is a base64-encoded JSON envelope carrying an IV, a
MAC and the value — roughly 250–350 characters for a token of this length,
against a 191-character column. MySQL would reject or truncate it depending on
strict mode, and a truncated ciphertext is an install that can never be
decrypted again.

**Fix, in this order, in one deploy:**

1. A migration widening both columns to `TEXT`.
2. The casts:

```php
'accessToken' => 'encrypted',
'refreshToken' => 'encrypted',
```

3. Clear the `Session` table. Existing rows are plaintext and would fail to
   decrypt. There is one install today, so the next admin load simply
   re-exchanges a token — cheaper and safer than a re-encrypting backfill.

**And one standing consequence.** `APP_KEY` becomes a credential that must
survive forever. Lose it and every install breaks, because no token can be
decrypted. It belongs in the host's secret manager with a recoverable copy —
never regenerated on deploy.

### 3. Email cannot be delivered

`MAIL_MAILER` defaults to `log` and no provider is configured. Three
shopper-facing emails depend on it: claim received, merchant decision, and the
post-purchase protection offer.

`MailDelivery::isReady()` now refuses to pretend otherwise, and
`php artisan kourify:mail-check` reports the gap, so the app fails honestly
rather than silently. That is the safe state, not a working one.

**WARNING — and this is why `log` must never reach production:** with
`MAIL_MAILER=log`, every message body is written to `storage/logs`. Those
bodies carry shopper names, order numbers and addresses. A production log file
then holds personal data indefinitely, and nobody receives the email.

**Needed:** a domain the company controls, verified with the provider (SPF,
DKIM, ideally DMARC), then five `.env` values — `MAIL_MAILER=smtp`,
`MAIL_HOST`, `MAIL_PORT=587`, `MAIL_USERNAME`, `MAIL_PASSWORD` — plus
`MAIL_FROM_ADDRESS` on that domain. `docs/email-delivery.md` in the backend
repo has the detail.

---

## 🟠 Fix before merchants

### 4. The storefront rate limiter keys on an IP nobody has measured

`app/Services/RateLimiter.php::clientIp()` reads four headers and trusts the
first one present:

```php
private const TRUSTED_IP_HEADERS = [
    'cf-connecting-ip',
    'true-client-ip',
    'fly-client-ip',
    'x-real-ip',
];
```

falling back to the right-most `x-forwarded-for` entry, then to the literal
string `'unknown'`. Three shopper-facing endpoints key their bucket on it —
`Storefront/ClaimController`, `ClaimItemsController` and `SettingsController`
(`"claim:{$shop}:".$this->limiter->clientIp($request)`).

**This is not an open-internet bypass.** All six storefront routes sit behind
`shopify.proxy` in `routes/shopify.php`, and `VerifyShopifyAppProxy` rejects
anything without a valid HMAC over the query string. The SDK also refuses a
`timestamp` more than 90 seconds old, so signatures cannot be replayed
indefinitely. An attacker cannot reach these endpoints directly at all.

**What is actually wrong is that the value is undocumented and unmeasured.**
Shopify documents which headers it strips from proxy *responses*; it does not
document which client-IP headers it forwards on the way *in*. So one of two
things is true in production and nobody has checked which:

- **Shopify forwards none of the four, and no `x-forwarded-for`.** Then every
  shopper on a shop collapses into one bucket, `claim:{shop}:unknown`. One
  shopper submitting claims would lock out every other shopper on that store.
  This is the likelier case, and it harms legitimate traffic rather than
  stopping an attack.
- **Shopify forwards `x-forwarded-for` ending in its own egress IP.** Then
  shoppers share a bucket per Shopify egress address — the same problem, spread
  across a handful of buckets instead of one.

There is also a narrow genuine bypass. The proxy HMAC covers the query string,
not the headers, so a shopper holding one freshly signed proxy URL can vary
`X-Real-IP` on each request and get a new bucket every time, for the 90 seconds
that signature stays valid. Bounded, but real, and it is the claim-submission
endpoint.

**Fix:** measure first, then decide. Log `clientIp()` alongside
`x-forwarded-for` and the four headers on one real storefront claim, and read
what Shopify actually sends. Then:

- If no usable client IP arrives, stop keying on it. Key on something the
  signature covers — the `logged_in_customer_id` the middleware already
  extracts, or the order number being claimed — so one shopper cannot throttle
  another.
- If a real client IP does arrive, configure Laravel's trusted proxies in
  `bootstrap/app.php` and take `$request->ip()`, which validates the hop chain
  instead of trusting whichever header appears first.

The admin endpoints are unaffected: they key on `shop` alone and sit behind
session verification.

### 5. Nothing prunes the tables that grow forever

There are no scheduled tasks at all — `routes/console.php` registers none, and
no `Schedule::` call exists anywhere in `app/`. So production needs no cron,
which is simpler, but it also means nothing ever deletes:

| Table | Grows with | Has an expiry column |
|---|---|---|
| `RateLimitBucket` | every rate-limited request | `expiresAt`, never swept |
| `ProtectionOffer` | every protection offer sent | `expiresAt`, never swept |
| `cache` | every cache write | yes, Laravel does not sweep it |
| `sessions` | session driver is `database` | yes, never swept |
| `failed_jobs` | every permanently failed job | no |

`RateLimitBucket` is the one that bites first: one row per shop-and-IP per
window, inserted on every storefront request and never removed.

`ProtectionOffer` has one `delete()`, at `ProtectionOffers.php:133`, but that is
a rollback when the offer email fails to send — deliberate, so an unreceived
offer cannot still be redeemed. It is not an expiry sweep, and expired offers
stay.

**Fix:** a scheduled prune in `routes/console.php`, and a cron entry
(`php artisan schedule:run` every minute) in the deploy. A `Prunable` model
with `php artisan model:prune` is the idiomatic route for the two Kourify
tables.

### 6. No CI in either repo

Neither repo has `.github/workflows` or any other CI configuration. There are
543 tests (492 backend, 51 frontend) and nothing runs them on push.

For a company repo this is usually the first thing asked for, and it is cheap:
one workflow per repo running `php artisan test` and
`pnpm typecheck && pnpm lint && pnpm test`. Both suites pass today, so CI
starts green.

### 7. The two-repo build is a deploy trap, and it is undocumented

The admin is built in the frontend repo and copied into the backend's `public/`
by `scripts/copy-to-backend.mjs`. Three things about that will break a first
deploy by someone who has not been told:

- **The backend repo deliberately does not contain the admin.**
  `public/index.html` and `public/assets` are gitignored, because the bundles
  are content-hashed and committing them would accumulate every past build.
  Deploying the backend repo alone therefore serves a 503 reading "The admin
  bundle is missing". That message is correct and deliberate — it is not a bug
  to chase.
- **`copy-to-backend.mjs` assumes the two checkouts are sibling folders.**
  Override with `KOURIFY_BACKEND_PUBLIC` when they are not. It refuses to write
  to a directory with no `index.php`, so a wrong path fails safely.
- **`VITE_SHOPIFY_API_KEY` is baked in at build time, not read at runtime.**
  Build with it unset and the bundle ships an empty client id and App Bridge
  never initialises. Verified: the current build does contain the client id.

**The build order, which exists nowhere in either repo:**

```bash
# 1. frontend repo — build the admin and copy it into the backend's public/
pnpm install --frozen-lockfile
pnpm build:deploy              # needs VITE_SHOPIFY_API_KEY set

# 2. backend repo — install, migrate, cache for production
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan config:cache && php artisan route:cache && php artisan event:cache

# 3. tell any running worker to pick up the new code, then run one
php artisan queue:restart      # running workers hold the old code otherwise
php artisan queue:work         # a separate process from the web server

# 4. frontend repo — ship config and extensions to Shopify
pnpm run deploy                # NOT `pnpm deploy` — see below
```

Steps 1–3 deploy the app. Step 4 is separate and only ships `shopify.app.toml`
and the theme/checkout/function extensions; it reaches no admin screen.

Two details that are easy to get wrong:

- **`pnpm run deploy`, with the `run`.** Bare `pnpm deploy` is pnpm's own
  built-in workspace-deploy command and will not run the `deploy` script at
  all. `npm run deploy` is equivalent and is what has been used so far.
- **Pass no `--tries` or `--timeout` to the worker.** The jobs declare their
  own — `IngestBulkOrders` needs `timeout = 900` with `tries = 3`,
  `BillUsageEvent` sets `tries = 4` — and a flag on the command overrides them
  for every job. A global `--timeout` short of 900 would kill an order
  backfill mid-ingest. `DB_QUEUE_RETRY_AFTER=1200` must stay above the longest
  of them.

---

## 🟡 Handover gaps

### 8. 13 fields in the Translations editor show the merchant nothing

The claim page's English copy exists in two repos. The backend renders from
`lang/claim/{en,fr,ar,hi}.php`. The frontend's `app/lib/claim-i18n.ts` holds a
copy of the same strings, used for one thing: the grey English reference shown
beside each input in the Translations editor, and that input's placeholder.

Counted, per locale:

| | Frontend `claim-i18n.ts` | Backend `lang/claim/*.php` |
|---|---|---|
| keys | 64 | 77 |

The 61 keys both files quote plainly have **identical English values**, so
nothing has drifted in wording. The problem is the 13 keys the frontend never
got:

```
error.itemRequired       error.noClaimableItems   error.notProtected
error.quantityRequired   field.item               field.item.loading
field.quantity           field.quantity.hint      progress.item
progress.item.short      review.item              step.item.copy
step.item.title
```

Every one is item-level claim copy — the "Which item?" step — and every one is
rendered to shoppers by `resources/views/storefront/claim-form.blade.php`.

**What this does and does not break.** The editable key set comes from the API,
not from this file (`const { languages, keys, optionalKeys } = data`), so all
77 are editable and all four shipped languages render the item step translated.
Nothing is missing from the claim page.

What breaks is the editor. For these 13, `referenceEn[key]` is `undefined`, so:

```jsx
<s-text color="subdued">{referenceEn[key]}</s-text>   // renders nothing
<s-text-field placeholder={referenceEn[key]} ... />   // no placeholder
```

and the field's own label is visually hidden
(`labelAccessibilityVisibility="exclusive"`). The merchant gets an empty grey
box above an empty input with no visible label — thirteen times, covering the
whole item step — and no way to tell what string they are being asked to
translate. They are most likely to leave them blank, which is the one outcome
that looks like nothing is wrong.

**Fix:** have the API return the English reference alongside the key set, so
one list serves both and a new string cannot arrive half-registered. A test
asserting the two key sets match is the cheap stopgap.

### 9. `.env.example` is complete, but its defaults are development values

Checked properly: every variable the company *must* set is documented in the
backend's `.env.example`. The ones absent from it are stock Laravel driver
settings with working defaults in `config/` (Redis, SQS, Memcached, Postmark,
`DB_SOCKET`, `SESSION_TABLE` and so on) — nothing the company has to discover.

**WARNING: the file's own values are the development ones.** Copy it to
`.env`, fill in the blanks, and production comes up like this:

```
APP_ENV=local
APP_DEBUG=true
LOG_LEVEL=debug
MAIL_MAILER=log
APP_URL=http://localhost:8000
```

`APP_DEBUG=true` is the dangerous one. Laravel's debug error page prints the
environment alongside the stack trace, so the first unhandled exception in
production shows a visitor the database password and the Shopify client secret.
`MAIL_MAILER=log` is finding 3. `LOG_LEVEL=debug` on top of those writes far
more shopper data to disk than it should.

**Fix:** either state the production values in the comments beside each one, or
add a deploy-time guard that refuses to boot when `APP_ENV=production` and
`APP_DEBUG` is true. The guard is better — a comment can be skipped, a refusal
cannot.

Two more worth documenting in the same pass, both currently undocumented:

- `SESSION_SECURE_COOKIE` — should be `true` in production. Low impact here,
  since the admin authenticates by token exchange and the storefront by HMAC,
  so no cookie carries authority. Set it anyway.
- `APP_PREVIOUS_KEYS` — how Laravel decrypts data written under an older
  `APP_KEY`. Irrelevant today, essential the moment finding 2 lands and
  `APP_KEY` ever has to rotate.

### 10. Both READMEs are still stock template text

- Backend `README.md` is Laravel's default — framework marketing, Laracasts
  links, nothing about Kourify.
- Frontend `README.md` is the Shopify React Router template's, and it tells the
  reader to run `shopify app init`, which is wrong for this repo.

A new engineer opening the company repo learns nothing about what the project
is, that it is two repos, how to run it, or how to deploy it. Of everything in
this document this is the cheapest to fix and the most read.

### 11. 3.8 MB of vendored agent tooling, against the repo's own instruction

`.agents/` holds 41 tracked files, including six Brotli-compressed Shopify
Admin schema dumps of roughly 500 KB each. It is 3.8 MB of a 4.2 MB repository.

`AGENTS.md` in the same repo says, of that exact toolkit: "do not add tooling
to this repo."

**Fix:** `git rm -r --cached .agents` and add it to `.gitignore`. History keeps
the blobs unless it is rewritten, which is probably not worth it for 3.8 MB.

### 12. 13 dependency advisories, none of which reach shipped code

`pnpm audit --prod` reports 2 critical, 9 high, 2 moderate. Every path traced
to build tooling:

| Advisory | Reached through | Runs in production? |
|---|---|---|
| `proxy-addr` (critical) | `@react-router/serve` → `express` | No — Laravel serves the SPA |
| `shell-quote` (critical) | `@shopify/shopify_function` codegen | No — build-time only |
| `brace-expansion` ×4, `braces` | `minimatch` / `fast-glob` in codegen and types tooling | No |
| `source-map-js` | `vite` → `postcss` | No — build-time |
| `compression` | `@react-router/serve` | No |
| `@graphql-tools/*` ×2 | extension codegen | No |

The shipped bundle was checked directly and contains none of them.

**Note on the obvious fix, which is wrong:** `@react-router/fs-routes` sits in
`dependencies` rather than `devDependencies`, which is why `--prod` surfaces
the React Router chain at all. Do not move it. The upstream template moved it
there deliberately (`CHANGELOG.md:83`, "Move `@remix-run/fs-routes` to
`dependencies` to fix Docker image build") and `app/routes.ts` imports it.

**Fix:** `pnpm update` the transitive ranges that resolve cleanly, and record
the rest as accepted build-time risk. `composer audit` on the backend reports
no advisories at all. Expect the company's scanner to raise these on day one —
better to arrive with the written explanation than to answer it later.

### 13. Neither repo has a LICENSE

Normal for a private repo, but the company's tooling may expect one. Their call.

### 14. Commits are authored under two different personal addresses

`git log --all --format='%an <%ae>'` shows the same name against two personal
email addresses, in both repos. Both become visible to everyone with repository
access once it is pushed, and that cannot be undone without rewriting history.

Worth a decision now rather than a question later: either accept it, or set a
company address with `git config user.email` for future commits. The addresses
are deliberately not reproduced here, so this document can be read by anyone.

### 15. The Shopify app belongs to a personal Partner organisation

`client_id = "05f95f63f2b874fd2f6103a4ebb7d697"` is an app in the current
Partner org. Before the company can run `shopify app deploy`, either that app
is transferred to the company's Partner organisation, or a new app is created
there and `client_id` plus both `.env` credentials are swapped.

The client secret goes into the host's secret manager. Never into a commit, an
issue, a chat message or a CI log. If it is ever exposed, rotate it in the
Partner Dashboard and use `SHOPIFY_API_SECRET_OLD` to keep in-flight requests
verifying through the overlap — the backend already supports that.

---

## Code duplication

Measured with a token-shingle detector over both repos: comments and imports
stripped, then every run of N identical real lines reported. Run at N=6 and
again at N=4.

**The backend is clean.** At a six-line window, its 100 files in `app/` yield
three clusters. At four lines it has a handful more, all incidental — two
models sharing a `casts()` array, two `match` arms both ending `default =>
null`. Nothing worth extracting.

**Two things in the backend are worth extracting, both small:**

- `app/Mail/ClaimSubmitted.php` and `app/Mail/ClaimStatusChanged.php` share
  their constructor, their `content()` and their locale resolution almost line
  for line. They already extend `SpeaksToTheShopper`, so the shared half
  belongs in that base class.
- The `stagedUploadsCreate` GraphQL mutation is written out twice, in
  `app/Services/EvidenceUpload.php:243` and
  `app/Services/ProtectionProduct.php:315`.

**Two duplications in the theme extension are forced, not sloppy.** Worth
recording so nobody "fixes" them:

- `protection-cart.liquid` and `protection-product.liquid` carry nearly
  identical `{% schema %}` blocks. A theme app extension block must declare its
  own schema; Shopify provides no way to share one.
- Three blocks repeat the same `assign` lines that read the brand metafields.
  The code says why: a rendered snippet gets its own scope, so it cannot set
  variables in its caller, and capturing the render injected Shopify's own
  "BEGIN app snippet" comment into the output.

**What is not duplicated, checked specifically.** The RTL language list exists
once (`app/Domain/Locale.php`). Claim-window enforcement lives in the backend
only. Translation length caps live in `ClaimTranslations::CAPS` only. The
frontend's `.myshopify.com` regex looks like a copy of `ShopDomain` but is not
— it validates an admin hostname before it reaches an `href`, a different job.

**In the frontend admin, one file repeats itself.**
`app/routes/app.settings.tsx` carries the same controlled-input `onChange`
three times for money fields and twice more for day fields — parse, clamp,
`toFixed(2)`, write back. A small typed input component would absorb all five.
`app/routes/app.claims.tsx:440` and `app/routes/app.orders.tsx:365` also share
a six-line row control, which is a shared-component candidate rather than a
problem.

**The duplication that matters is a business rule written three times.**
Whether a claim needs a photo exists in three places, in three languages:

| Copy | Where | Who it governs |
|---|---|---|
| `IssueType::requiresEvidence()` | `app/Domain/IssueType.php:42` | **authoritative** — rejects the claim |
| `var requiredEvidence=["damaged","concealed"]` | `claim-form.blade.php:160` | the shopper's form, inline JS |
| `EVIDENCE_REQUIRED_TYPES` | `app/lib/claim-window.ts:13` | admin only |

All three read `damaged, concealed` today. The second is the one that matters:
it is hardcoded in the shopper-facing page, it decides whether the photo field
is even shown (`syncEvidence()`), and it is in a different repo from the PHP
that enforces the rule. Add a seventh issue type that needs evidence and the
server will reject claims for a field the shopper was never shown.

The claim windows are duplicated too — `ClaimWindows::defaults()` in PHP,
`DEFAULT_CLAIM_WINDOWS` in TypeScript, with the same six values (`lost 0/30`,
`damaged 0/7`, `stolen 3/15`, `shortage 0/7`, `concealed 0/14`,
`wrong_item 0/14`) and two implementations of the same JSON fallback parser.
This one is less dangerous than it first looks: `claim-window.ts` is imported
only by `app/routes/app.settings.tsx` and its own test, so it is the merchant's
settings editor, not the shopper's form. A drift would show the merchant
different defaults from the ones the server enforces.

**Fix:** the Blade page should take `requiredEvidence` from the server that
owns the rule — it is already rendering that page and already has
`IssueType::requiresEvidence()` — rather than restating it in inline
JavaScript. For the windows, a test comparing the TypeScript defaults against
the PHP defaults starts green and only speaks up when someone edits one copy.

---

## ⚠️ How to share the repos

**Push to the new remote with git. Do not copy, zip or sync the folders.**

The tracked files are clean. The working directories are not, and every one of
these is correctly gitignored — which means a copy carries them and a push does
not:

| In the working directory | Why it must not travel |
|---|---|
| `.env` (both repos) | live `SHOPIFY_API_SECRET` and `APP_KEY` |
| `storage/logs/` | with `MAIL_MAILER=log`, full shopper emails: names, orders, addresses |
| `.shopify/` | CLI session and app state |
| `database/database.sqlite` | local database |
| `public/assets/`, `public/index.html` | a stale build |
| `node_modules/`, `vendor/` | reinstall from the lockfiles |

```bash
git remote add company git@github.com:<org>/<repo>.git
git push company main
```

---

## ✅ Checked and passing

Each of these was run, not assumed.

**No secrets in either history.** Scanned the full content of every commit on
every branch (`git log --all -p`) in both repos for Shopify token prefixes
(`shpat_`, `shpss_`, `shpca_`, `shppa_`), `base64:` Laravel keys, AWS key ids
and private-key blocks: zero hits. Also matched the live `SHOPIFY_API_SECRET`
and `APP_KEY` values from the local `.env` against both histories as literal
strings: zero hits. `.env` has never been committed to either repo, and
`.gitignore` covers it in both — the frontend's carries a deliberate
`!.env.example` re-inclusion with the reason written beside it.

**The shipped admin bundle carries no secret.** `build/client` was searched for
token prefixes, `SHOPIFY_API_SECRET` and `base64:` keys: none. The client id is
present, which is correct — it is public by design and every embedded app hands
it to the browser.

**Production config caching works.** `config:cache`, `route:cache` and
`event:cache` all succeed, which is the real test for route closures. Relatedly,
`env()` is called nowhere outside `config/` — the usual way a cached config
turns settings into `null` in production.

**Tests pass.** 492 backend tests / 2,235 assertions, and 51 frontend tests.
`pnpm typecheck` and `pnpm lint` are clean. `pnpm build` succeeds.

**`composer audit`:** no advisories.

**Clickjacking is handled.** `AdminAppController` sends
`Content-Security-Policy: frame-ancestors https://{shop} https://admin.shopify.com`
per request, and `frame-ancestors 'none'` when the shop cannot be determined —
including a spoofed `shop` parameter, which is covered by a test.

**A half-finished deploy says so.** A missing admin bundle returns an explicit
503 rather than a blank frame inside Shopify admin.

**No debug leftovers.** No `dd(`, `dump(`, `var_dump(`, `ray(` or `die(` in
backend `app/`, `routes/` or `config/`; no `console.log` or `debugger` in
shipped frontend or extension code; no `TODO`/`FIXME`/`HACK` markers in either.

**No hardcoded hosts in shipped code.** No `localhost`, `127.0.0.1`,
`trycloudflare`, `ngrok` or `example.com` in frontend `app/` or `extensions/`.
The placeholders are confined to `shopify.app.toml`, where finding 1 covers
them.

**Routing is explicit, not a catch-all.** `routes/web.php` registers `/` and
`/app/{path?}` only, so an unknown `/webhooks` path cannot be answered with the
admin's HTML — which Shopify would read as a successful delivery.

**Webhooks are complete.** Eleven subscriptions including all three mandatory
privacy topics (`customers/data_request`, `customers/redact`, `shop/redact`),
and `app/scopes_update`.

---

## Carried forward from earlier work

Open items this audit did not change, listed so none is lost in the handover:

- **Protected Customer Data approval** is not granted, so `displayName` is
  stripped from order sync and `ORDER_SYNC_ENABLED` stays `false`.
  `read_customers` is held for the moment it lands.
- **`write_orders` → `read_orders` is unproven on a live store.** Order reads
  were verified (26 orders). One fulfillment and one protection offer still
  need to run without it; a 403 in either means the scope has to go back.
- **`php artisan kourify:rebrand-protection --images`** has not been run. Until
  it is, the checkout line reads "Kourify Order Protection" rather than the
  merchant's brand. It mutates a live catalogue product, so it asks first.
- **"Reply to this email"** appears in `claim_status.body` in all four
  languages and routes to the app's mailbox, which nobody reads. Drop the
  sentence or add a real `Reply-To` from a merchant contact field.
- **fr, ar and hi mail copy has had no native-speaker review.**
- **The cart block's `preview_price_cents`** renders a merchant-typed figure
  before the proxy answers, so a shopper can briefly see a price that is not
  the real one. See 1.1.4 in `docs/app-store-review-audit.md`.
- **Billing decline and reinstall paths** are correct on reading but have never
  been exercised end to end.

## Suggested order

1. Hosting (finding 1) — everything else is untestable without it.
2. Encrypt the tokens (2) while there is one install to re-exchange.
3. READMEs, the build order, the .env defaults and the empty translation
   references (7, 8, 9, 10) before anyone else touches the repos.
4. Measure what the app proxy sends as a client IP, then fix the limiter (4).
5. CI (6), then the prune schedule (5).
6. Domain and mail provider (3).
7. Dependency updates (12) before the company's scanner reports them.
