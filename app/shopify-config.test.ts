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
   * The CLI's schema requires [auth], and refuses to start without it —
   * removing it as dead config is what taught us that. It stays pointed at a
   * page that exists: token exchange is the whole auth story here and the PHP
   * package ships no OAuth callback, so a redirect that ever did fire should
   * land somewhere that authenticates rather than on a 404.
   */
  it("keeps the auth section the CLI insists on", () => {
    expect(toml).toMatch(/^\[auth\]$/m);
    expect(toml).toMatch(/^\s*redirect_urls\s*=\s*\[\s*"[^"]+"/m);
  });

  /**
   * The scopes, pinned.
   *
   * Not because the list is sacred, but because of what changing it costs.
   * Adding one makes Shopify ask every merchant to approve the app again --
   * and this app has already spent two of those in two days, read_locales on
   * 2026-10-05 and read_themes and read_orders together on 2026-10-06.
   * Removing one is silent, which is worse: an accidental deletion takes a
   * capability away and nothing anywhere says so until a call starts failing
   * in production.
   *
   * So a change here has to be two edits, and the second one is this list.
   * Shopify's own words for what the first edit costs:
   * shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes
   */
  it("asks for exactly the scopes it exercises", () => {
    const declared = /^\s*scopes\s*=\s*"([^"]*)"/m.exec(toml)?.[1] ?? "";

    expect(declared.split(",").sort()).toEqual([
      // Reserved for Protected Customer Data approval; no query reads
      // `customer` while displayName is stripped.
      "read_customers",
      "read_locales",
      "read_orders",
      "read_themes",
      "write_cart_transforms",
      "write_files",
      "write_fulfillments",
      "write_merchant_managed_fulfillment_orders",
      "write_order_edits",
      "write_products",
      "write_publications",
    ]);
  });

  /**
   * The restricted scopes, by name. Each one needs Shopify's approval before
   * an app may hold it, and asking for one uninvited is a rejected review.
   */
  it("asks for none of the scopes that need Shopify's permission first", () => {
    for (const restricted of [
      "read_all_orders",
      "write_payment_mandate",
      "write_checkout_extensions_apis",
      "read_advanced_dom_pixel_events",
      "read_checkout_extensions_chat",
    ]) {
      expect(toml).not.toContain(restricted);
    }
  });
});
