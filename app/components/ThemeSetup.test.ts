import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * The deep links that place our blocks in a merchant's theme.
 *
 * Nothing else can catch a mistake in them. tsc sees a template string;
 * Theme Check never looks at this repo's TypeScript; and a wrong link does not
 * throw -- Shopify opens the theme editor and tells the merchant the block
 * could not be found, which reads to them as a broken app. The failure mode is
 * silent on our side and loud on theirs, so the shape is pinned here.
 *
 * `vi.stubEnv` runs before the import on purpose: the module reads the client
 * id at load time, exactly as the browser does with Vite's inlined value.
 */
const API_KEY = "05f95f63f2b874fd2f6103a4ebb7d697";

vi.stubEnv("VITE_SHOPIFY_API_KEY", API_KEY);

const { SURFACES, themeBlockLink } = await import("./ThemeSetup");

const SHOP = "oveelab.myshopify.com";
const BLOCKS = "extensions/kourify-badges/blocks";

/** The `name` a block gives itself in its own schema. */
function schemaName(handle: string): string {
  const liquid = readFileSync(`${BLOCKS}/${handle}.liquid`, "utf8");
  const schema = /{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/.exec(liquid);

  expect(schema, `${handle}.liquid has a schema`).not.toBeNull();

  return JSON.parse(schema![1]).name as string;
}

describe("the surfaces the Help page documents", () => {
  it("names a block that exists", () => {
    const files = readdirSync(BLOCKS);

    for (const surface of SURFACES) {
      expect(files, surface.editorName).toContain(`${surface.handle}.liquid`);
    }
  });

  /*
   | The instructions tell a merchant to look for a block by name, so the name
   | printed here has to be the name the theme editor prints. These drifted
   | once already in the other direction -- the app called the cart block
   | "Protectify" long after the block was renamed.
   */
  it("calls each block what the theme editor calls it", () => {
    for (const surface of SURFACES) {
      expect(schemaName(surface.handle)).toBe(surface.editorName);
    }
  });

  /*
   | Every shipped block is documented. A block a merchant can see in their
   | theme editor and find no mention of is the failure this whole panel
   | exists to fix, so adding one has to be a deliberate edit in two places.
   */
  it("documents every block the extension ships", () => {
    const shipped = readdirSync(BLOCKS)
      .filter((file) => file.endsWith(".liquid"))
      .map((file) => file.replace(/\.liquid$/, ""))
      .sort();

    expect(SURFACES.map((surface) => surface.handle).sort()).toEqual(shipped);
  });

  /*
   | An app embed is switched on for the whole theme and an app block is placed
   | on one template, and Shopify spells them with different parameters:
   | activateAppId with context=apps for the first, addAppBlockId with a
   | template and a target for the second.
   | shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
   */
  it("builds the documented URL for each kind of block", () => {
    expect(themeBlockLink(SHOP, "guarantee-tab")).toBe(
      `https://${SHOP}/admin/themes/current/editor` +
        `?context=apps&activateAppId=${API_KEY}/guarantee-tab`,
    );

    expect(themeBlockLink(SHOP, "protection-product")).toBe(
      `https://${SHOP}/admin/themes/current/editor` +
        `?template=product&addAppBlockId=${API_KEY}/protection-product` +
        `&target=mainSection`,
    );

    expect(themeBlockLink(SHOP, "protection-cart")).toBe(
      `https://${SHOP}/admin/themes/current/editor` +
        `?template=cart&addAppBlockId=${API_KEY}/protection-cart` +
        `&target=newAppsSection`,
    );
  });

  it("leaves the slash and colon Shopify expects unencoded", () => {
    const link = themeBlockLink(SHOP, "protection-product")!;

    expect(link).not.toContain("%2F");
    expect(link).not.toContain("%3A");
  });

  /*
   | No button is better than a button to nowhere. Every one of these used to
   | be a plausible way to ship `https://undefined/admin/...` into an href.
   */
  it("refuses a shop it cannot vouch for", () => {
    for (const shop of [
      undefined,
      "",
      "   ",
      "oveelab",
      "example.com",
      "evil.com/?x=.myshopify.com",
      "oveelab.myshopify.com.evil.com",
    ]) {
      expect(themeBlockLink(shop, "protection-product"), String(shop)).toBeNull();
    }
  });

  it("refuses a handle it does not know", () => {
    expect(themeBlockLink(SHOP, "protectify")).toBeNull();
  });
});
