# Scaling Kourify to 100,000 merchants

Rendered version: https://claude.ai/code/artifact/299abfaa-e0ed-4c9d-b451-8c2b141a2867

Current scale: single dev store (`oveelab.myshopify.com`), ~28 orders.
Target: 100,000 merchants.

Grounded in the actual bottlenecks in this codebase, not generic advice.
Update this file as items get implemented — check them off and note the PR/commit.

---

## 1. Where it breaks first

| Layer | Location | What breaks at 100K | Severity |
| --- | --- | --- | --- |
| Storefront settings | `app/routes/proxy.settings.tsx` | Every badge/cart/claim-form pageview hits `merchantSettings.findUnique` directly — no cache. Highest-QPS path to MySQL, multiplied by every storefront visitor of every shop. | **Critical** |
| Rate limiting | `app/lib/rate-limit.server.ts` | `isRateLimited()` opens a full read-modify-write DB transaction on every gated request. Correct across instances, but turns rate-limiting itself into write load on the primary — worse the more it's needed. | **Critical** |
| Connection pool | `app/db.server.ts` | Plain `new PrismaClient()`, no `connection_limit` set on `DATABASE_URL`. Each app instance opens its own pool against one MySQL primary — instances × default pool size races toward MySQL's `max_connections`. | High |
| Protection filter | `app/routes/app.orders.tsx` | `protectedOrder.findMany` with no `take` loads every protected order for a shop just to build an id list for filtering. Fine at 30 orders; not fine at 500K. | High |
| Order backfill | `app/lib/order-bulk-sync.server.ts` | Already routes through Shopify's Bulk Operations API + a `SyncJob` table instead of paginating inline. **Already correct** — the one part of this app built for six-figure order counts. | Sound ✓ |

---

## 2. The plan

### Phase 0 — Stop the bleeding (now – 2 weeks)

Cheap, surgical fixes that buy headroom for everything else.

- [ ] **Cache-aside the settings read.** Redis, 60s TTL, keyed by shop. Invalidate on save. Cuts the highest-QPS DB path to near zero. *(critical path)*
- [ ] **Move hot-path rate limits to Redis.** `INCR` + `EXPIRE`, atomic, no transaction. Keep the DB-backed limiter only for low-frequency admin actions. *(critical path)*
- [ ] **Set an explicit connection pool size.** `connection_limit` on `DATABASE_URL`, sized so (instances × pool) stays under MySQL's `max_connections` with headroom. *(prevents outage)*
- [ ] **Add a composite index / denormalized column for the protection filter.** Either an index Prisma can use, or a `protected` boolean on `Order` so filtering is an indexed column, not an in-memory id-list join.

### Phase 1 — Make it horizontal (1 – 3 months)

The app is already stateless per-request; the data layer isn't yet ready to scale out behind it.

- [ ] **Read replicas for MySQL.** Admin dashboards/analytics read from a replica; only writes and the post-cache storefront settings read hit the primary.
- [ ] **Real queue for background work.** SQS or a managed Redis queue behind order sync, offer emails, webhook processing — replacing the current `SyncJob` row + polling loop with proper retry/backoff/dead-letter handling.
- [ ] **Structured logging + APM.** Per-shop request tracing (Datadog/Sentry) so a slow tenant shows up before it takes the fleet down with it.
- [ ] **Load-test at target scale.** k6/Artillery simulating 10K–100K shops' worth of storefront + webhook traffic against a staging replica of the schema.

### Phase 2 — Design for six figures (3+ months)

Changes that only pay off once merchant count is large enough to need them.

- [ ] **Shard by shop hash** — only once a single primary genuinely can't take the write volume. Sharding early is pure overhead most apps never need.
- [ ] **Edge-cache the settings API response.** Badge/checkout JS already goes through the theme extension's CDN — extend the same treatment to the settings API with a short-TTL edge cache.
- [ ] **Canary rollouts.** Ship schema and pricing-logic changes to 1% of shops before 100% — a bad Cart Transform sync should cost a handful of merchants a minute, not all of them.

---

## 3. Guardrails that hold at every phase

- **Every query is shop-scoped.** No query pattern that could accidentally cross tenants — already consistent in this codebase; keep it a hard rule as more people touch it.
- **Webhook handlers are idempotent.** Shopify retries; a handler that isn't safe to run twice will eventually double-charge or double-email someone.
- **No unbounded query without a shop-level cap.** Every `findMany` either paginates or is provably bounded by something small (a shop's protected-order count, not its total order count).
- **One noisy shop can't starve another.** Per-shop rate limits and queue fairness, not just global ones — already true for the storefront rate limiter; carry it into the queue design.
