import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * shopify.app.toml is the only place webhook subscriptions are declared —
 * nothing registers them at runtime — and the backend that answers them lives
 * in another repo, so nothing else can notice when the two drift.
 *
 * Three topics had already gone missing this way. A sync started and was
 * never told its export finished; a refunded order kept its coverage. Both
 * failed silently, because Shopify retries a 404 rather than reporting it.
 *
 * The list is pinned here so dropping one has to be a deliberate edit. It
 * matches RoutePathsTest in kourify-guarantee-backend.
 */
const WEBHOOK_PATHS = [
  "/webhooks/orders/create",
  "/webhooks/orders/updated",
  "/webhooks/orders/paid",
  "/webhooks/orders/cancelled",
  "/webhooks/refunds/create",
  "/webhooks/bulk_operations/finish",
  "/webhooks/app/uninstalled",
  "/webhooks/app/scopes_update",
  "/webhooks/customers/data_request",
  "/webhooks/customers/redact",
  "/webhooks/shop/redact",
];

const toml = readFileSync("shopify.app.toml", "utf8");

/** Every `uri = "..."` under [[webhooks.subscriptions]]. */
function declaredUris(): string[] {
  return [...toml.matchAll(/^\s*uri\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
}

describe("shopify.app.toml", () => {
  it("subscribes to every webhook the backend serves, and no others", () => {
    expect(declaredUris().sort()).toEqual([...WEBHOOK_PATHS].sort());
  });

  /**
   * Shopify's own spelling. These are underscores, not a style choice, and a
   * hyphen here means deliveries arrive at a path the backend does not serve.
   */
  it("keeps Shopify's exact path spellings", () => {
    for (const uri of declaredUris()) {
      expect(uri).not.toMatch(/-/);
      expect(uri.startsWith("/webhooks/")).toBe(true);
    }
  });

  /**
   * The App Proxy prefix and subpath are what make the storefront claim form
   * reachable at /apps/kourify. Changing either breaks every link already
   * sent to a shopper in an email.
   */
  it("keeps the App Proxy mounted where shoppers' links point", () => {
    expect(toml).toMatch(/^\s*subpath\s*=\s*"kourify"/m);
    expect(toml).toMatch(/^\s*prefix\s*=\s*"apps"/m);
    expect(toml).toMatch(/^\s*url\s*=\s*"[^"]+\/proxy"/m);
  });

  /**
   * Token exchange is the whole auth story; the PHP package ships no OAuth
   * callback. A redirect_urls entry would name a URL the backend answers
   * with a 404.
   */
  it("declares no OAuth redirect", () => {
    // The assignment, not the bare word: the file explains in a comment why
    // the setting is absent, and matching that would fail on the explanation.
    expect(toml).not.toMatch(/^\s*redirect_urls\s*=/m);
  });
});
