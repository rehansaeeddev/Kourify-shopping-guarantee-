import { useThemeSetup, type ThemePlacement } from "../lib/queries";

/**
 * Storefront setup: the one part of this app a merchant has to finish outside
 * it.
 *
 * Everything a shopper sees -- the guarantee tab, the "Protect your order"
 * box, the trust badges -- is a theme app extension block, and Shopify does
 * not let an app place one. From their own docs: "App embed blocks are
 * inactive until an app user turns them on in the theme editor, and your app
 * can't activate them on the app user's behalf." So a paid, fully configured
 * install shows a shopper nothing at all until the merchant opens the theme
 * editor themselves.
 *
 * Nothing in the app used to say that. We proved the cost of the omission on
 * our own test store on 2026-10-01: its cart had been showing a hand-written
 * copy of our card for three weeks, because nobody knew which block belonged
 * where -- and the dashboard was meanwhile reporting protection as live.
 *
 * The buttons are Shopify's documented deep links, which open the theme editor
 * with the block already added (or the embed already switched on), so the
 * merchant only has to drag and save.
 * https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
 */

/**
 * The app's client id, which is what a deep link identifies the extension by.
 *
 * `api_key`, not `uuid`: the docs now read "uuid is deprecated. Use api_key
 * instead", and api_key "is the same value as the client_id found in your
 * app's app.toml file". That matters practically as well as pedantically --
 * the UUID only exists in a .env file the CLI writes after a deploy, and this
 * repo has no such file, whereas the client id is already in the browser
 * because App Bridge is booted with it.
 */
const API_KEY = (import.meta.env.VITE_SHOPIFY_API_KEY as string | undefined) ?? "";

/** What Shopify calls the shop, and the only shape allowed into an href. */
const MYSHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export type Placement =
  /** An app embed: one switch for the whole theme, supported by every theme. */
  | { kind: "embed" }
  /**
   * An app block: placed on one template, and only on an Online Store 2.0
   * theme. `target` is Shopify's own vocabulary -- `mainSection` drops the
   * block into the template's main section, `newAppsSection` adds a fresh
   * Apps section to the template.
   */
  | { kind: "block"; template: string; target: "mainSection" | "newAppsSection" };

export type Surface = {
  /** The block's filename without .liquid, which is its deep-link handle. */
  handle: string;
  /** Word for word what the theme editor calls it, for finding it by hand. */
  editorName: string;
  /** What a shopper gets out of it. */
  shopperSees: string;
  /** Where it belongs, in a merchant's words rather than a template name. */
  where: string;
  /**
   * What else has to be true before a shopper sees it, where that is not
   * simply "it is placed".
   *
   * Three of these six hide themselves at runtime and each does it on a
   * different rule, so the rule belongs on the row rather than over the group:
   * a merchant who places a block and sees nothing has no way to tell a
   * mistake from a setting.
   */
  note?: string;
  placement: Placement;
  /** The button's words. An embed is switched on; a block is placed. */
  cta: string;
};

/** Without these three the app is invisible to shoppers. */
const REQUIRED: Surface[] = [
  {
    handle: "guarantee-tab",
    editorName: "Kourify Guarantee Tab",
    shopperSees:
      "A tab down the side of every page. It opens your guarantee and the claim form.",
    where: "Switches on once for the whole theme.",
    placement: { kind: "embed" },
    cta: "Turn on",
  },
  {
    handle: "protection-product",
    editorName: "Kourify Protection",
    shopperSees:
      'The "Protect your order" box. Where the shopper pays, they tick it to add protection; where you pay, it tells them the order is already covered.',
    where: "Product pages, next to the Add to cart button.",
    note: "Hidden while protection is switched off in Settings.",
    placement: { kind: "block", template: "product", target: "mainSection" },
    cta: "Add to product page",
  },
  {
    handle: "protection-cart",
    editorName: "Kourify Protect (Cart)",
    shopperSees:
      "The same box on the cart page, for shoppers who did not see it on the product page.",
    where: "The cart page.",
    note: "Hidden while protection is switched off in Settings.",
    placement: { kind: "block", template: "cart", target: "newAppsSection" },
    cta: "Add to cart page",
  },
];

/**
 * Reassurance only -- nothing to tick, nothing to buy.
 *
 * Not one rule between them, which is why each carries its own note. The two
 * trust badges run kourify-badge.js and check `badgesEnabled`; the protection
 * badge runs kourify-protection.js and decides on who pays, ignoring that
 * setting entirely. Saying "these show when Trust badges is on" over all three
 * would have been wrong about the first one.
 */
const OPTIONAL: Surface[] = [
  {
    handle: "protection-badge",
    editorName: "Kourify Protection Badge",
    shopperSees:
      "A small line saying this order is protected. No tick box, nothing to buy.",
    where: "Product pages, near the title or price.",
    note: "Not tied to Trust badges. It shows whenever you cover protection yourself — and when the shopper pays, only if you tick “Show the badge when the customer pays” in the block.",
    placement: { kind: "block", template: "product", target: "mainSection" },
    cta: "Add to product page",
  },
  {
    handle: "trust-badge",
    editorName: "Kourify Trust Badge",
    shopperSees: "A safe-checkout badge.",
    where: "Product pages.",
    note: "Shows only while Trust badges is switched on in Settings.",
    placement: { kind: "block", template: "product", target: "mainSection" },
    cta: "Add to product page",
  },
  {
    handle: "cart-badge",
    editorName: "Kourify Badge (Cart)",
    shopperSees: "The same safe-checkout badge, on the cart.",
    where: "The cart page.",
    note: "Shows only while Trust badges is switched on in Settings.",
    placement: { kind: "block", template: "cart", target: "newAppsSection" },
    cta: "Add to cart page",
  },
];

/**
 * Every surface this file documents.
 *
 * Exported for the test beside it, which checks each handle against the real
 * block files and each `editorName` against that block's own schema name. A
 * renamed block, or one added without a word of instruction, would otherwise
 * only show up as a merchant following directions that no longer match their
 * theme editor.
 */
export const SURFACES: Surface[] = [...REQUIRED, ...OPTIONAL];

/**
 * The shop's own admin host, or null when we are not sure of it.
 *
 * Checked against a pattern rather than trusted: this value ends up in an
 * href, and the one bug we will not ship is a button that sends a merchant to
 * `https://undefined/admin`. A shop that fails the check loses its buttons and
 * keeps the written instructions, which is the right way round.
 *
 * The domain carries `.myshopify.com` here. It is the admin hostname, not the
 * shop name the PHP backend strips the suffix from -- mixing those two up has
 * already cost us once.
 */
function adminHost(shop: string | undefined): string | null {
  const candidate = (shop ?? window.shopify?.config?.shop ?? "").trim();

  return MYSHOPIFY_DOMAIN.test(candidate) ? candidate.toLowerCase() : null;
}

/** The deep link for one surface, or null when we cannot build a real one. */
function deepLink(shop: string | undefined, surface: Surface): string | null {
  const host = adminHost(shop);

  if (host === null || API_KEY === "") return null;

  const editor = `https://${host}/admin/themes/current/editor`;
  const block = `${API_KEY}/${surface.handle}`;

  // Written out rather than run through URLSearchParams on purpose: Shopify's
  // own examples put a bare `/` inside addAppBlockId and a bare `:` inside
  // target, and percent-encoding either one stops the editor recognising it.
  // Every part interpolated here is either a literal from this file or a
  // hostname already matched against MYSHOPIFY_DOMAIN.
  return surface.placement.kind === "embed"
    ? `${editor}?context=apps&activateAppId=${block}`
    : `${editor}?template=${surface.placement.template}` +
        `&addAppBlockId=${block}&target=${surface.placement.target}`;
}

/**
 * One block's deep link, by handle, for a caller outside this file.
 *
 * The dashboard's setup guide uses it for `protection-product`, which is the
 * single link worth putting in front of a merchant who has not read anything.
 */
export function themeBlockLink(
  shop: string | undefined,
  handle: string,
): string | null {
  const surface = SURFACES.find((candidate) => candidate.handle === handle);

  return surface === undefined ? null : deepLink(shop, surface);
}

/** One row: what it is, where it goes, and the button that puts it there. */
function SurfaceRow({
  surface,
  shop,
  placed,
}: {
  surface: Surface;
  shop: string | undefined;
  /** undefined when the theme could not be read -- then claim nothing. */
  placed: boolean | undefined;
}) {
  const href = deepLink(shop, surface);

  return (
    <s-box padding="small">
      <s-grid
        gridTemplateColumns="@container (inline-size <= 640px) 1fr, 1fr auto"
        gap="base"
        alignItems="center"
      >
        <s-stack direction="block" gap="small-500">
          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-text type="strong">{surface.editorName}</s-text>
            <s-badge tone="neutral">
              {surface.placement.kind === "embed" ? "Switch" : "Block"}
            </s-badge>
            {/*
              Only ever drawn from a theme we actually read. A missing answer
              shows no badge at all rather than a grey "Not added" that would
              be a guess dressed up as a fact.
            */}
            {placed === true ? (
              <s-badge tone="success" icon="check">
                On your storefront
              </s-badge>
            ) : null}
          </s-stack>
          <s-text color="subdued">{surface.shopperSees}</s-text>
          <s-text color="subdued">{surface.where}</s-text>
          {surface.note ? (
            <s-text color="subdued" type="strong">
              {surface.note}
            </s-text>
          ) : null}
        </s-stack>
        {href === null ? null : (
          <s-stack direction="inline">
            {/*
              A new tab, not this frame. The admin refuses to be framed, so a
              same-frame navigation would land the merchant on a blank panel
              inside our own iframe.

              A block that is already there gets a quieter button and a verb
              that does not lie: pressing it adds a second copy, so offering
              "Add" again would be inviting the duplicate.
            */}
            <s-button
              href={href}
              target="_blank"
              variant={placed === true ? "tertiary" : undefined}
            >
              {placed === true ? "Open in theme editor" : surface.cta}
            </s-button>
          </s-stack>
        )}
      </s-grid>
    </s-box>
  );
}

/** A bordered list of rows, hairlined between them. */
function SurfaceList({
  surfaces,
  shop,
  theme,
}: {
  surfaces: Surface[];
  shop: string | undefined;
  theme: ThemePlacement | undefined;
}) {
  return (
    <s-box borderWidth="base" borderColor="strong" borderRadius="base">
      {surfaces.map((surface, index) => (
        <s-box key={surface.handle}>
          {index > 0 ? <s-divider /> : null}
          <SurfaceRow
            surface={surface}
            shop={shop}
            // Only a theme we read can answer this. Everything else -- still
            // loading, lookup failed, request refused -- is undefined, and
            // undefined draws no badge and changes no wording.
            placed={
              theme?.known === true ? theme.placed[surface.handle] : undefined
            }
          />
        </s-box>
      ))}
    </s-box>
  );
}

/**
 * A numbered instruction.
 *
 * A grid, not an inline stack. An inline stack treats the number and the
 * sentence as two items on one line and wraps the whole sentence under the
 * number as soon as it is too long to fit -- which left step 5 with its digit
 * stranded on a line of its own. Two grid columns give the text a track to
 * wrap inside instead.
 */
function Move({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <s-grid gridTemplateColumns="auto 1fr" gap="small-300" alignItems="start">
      <s-badge tone="neutral">{String(n)}</s-badge>
      <s-text color="subdued">{children}</s-text>
    </s-grid>
  );
}

/**
 * The instructions themselves.
 *
 * Rendered as a panel body, with no card of its own, so the Help page can wrap
 * it in the same titled panel as everything else on that page.
 */
export function ThemeSetup({ shop }: { shop?: string }) {
  const linked = adminHost(shop) !== null && API_KEY !== "";

  /*
   | Read, never waited on. The instructions are the point of this panel and
   | they are true whatever the theme turns out to hold, so they render at
   | once; the badges and the vintage warning appear a moment later. A failed
   | lookup leaves `known` false and the panel says exactly what it said
   | before any of this existed.
   */
  const theme = useThemeSetup().data;
  const vintage = theme?.known === true && !theme.supportsAppBlocks;

  return (
    <s-stack direction="block" gap="base">
      <s-paragraph>
        Shopify does not let an app put anything into your theme. You place
        these once yourself, in your theme editor. Until you do, shoppers see
        nothing on your storefront — even with protection switched on in
        Settings.
      </s-paragraph>

      {vintage ? (
        <s-banner
          tone="warning"
          heading={`${theme?.themeName ?? "Your theme"} cannot hold app blocks`}
        >
          <s-paragraph>
            It is an older “vintage” theme, built before Online Store 2.0, and
            Shopify allows app blocks only in newer ones. The guarantee tab
            below still works — it is a switch, not a block. The product and
            cart boxes do not, and their buttons will fail. Switching to any
            theme from Shopify’s theme store fixes it.
          </s-paragraph>
        </s-banner>
      ) : (
        <s-banner tone="info" heading="Your theme needs to support app blocks">
          <s-paragraph>
            The three boxes below need an Online Store 2.0 theme — that is any
            theme from Shopify’s theme store since 2021. On an older “vintage”
            theme the guarantee tab still works, but the product and cart boxes
            cannot be added, and the button will tell you so.
          </s-paragraph>
        </s-banner>
      )}

      {!linked && (
        <s-banner tone="warning" heading="Buttons are not available right now">
          <s-paragraph>
            We could not read your shop address, so the one-click buttons are
            hidden. Open your theme editor yourself — Online Store → Themes →
            Customize — and add the blocks by the names listed below.
          </s-paragraph>
        </s-banner>
      )}

      <s-stack direction="block" gap="small-200">
        <s-heading>Must be placed</s-heading>
        <s-text color="subdued">
          Without these three, Kourify is invisible to your shoppers.
        </s-text>
      </s-stack>
      <SurfaceList surfaces={REQUIRED} shop={shop} theme={theme} />

      <s-stack direction="block" gap="small-200">
        <s-heading>How the theme editor works</s-heading>
      </s-stack>
      <s-stack direction="block" gap="small-300">
        <Move n={1}>
          Press a button above. Your theme editor opens in a new tab with the
          block already added, so you can see it before you keep it.
        </Move>
        {/*
          Watched this happen on 2026-10-06. The cart link was clicked on a
          store that already had the block, and the editor drew the box twice
          -- the button adds a block, it does not check for one. Harmless as
          long as the merchant knows, and confusing if nobody says it.
        */}
        <Move n={2}>
          If that block is already in your theme, you will now see two of them.
          Delete one, or just close the tab without saving — nothing has
          changed yet.
        </Move>
        <Move n={3}>
          Drag it up or down to move it. In the left-hand list, a block sits
          inside a section and can be dragged within it.
        </Move>
        <Move n={4}>
          Click the block to change its wording, its colour and the price you
          show. Those settings live in the theme editor, not in this app.
        </Move>
        <Move n={5}>
          Press <s-text type="strong">Save</s-text>. Nothing reaches a shopper
          until you save.
        </Move>
        <Move n={6}>
          To take one off later, click it and choose{" "}
          <s-text type="strong">Remove block</s-text>. To hide it for a while,
          use the eye icon next to its name. Uninstalling Kourify removes all of
          them for you.
        </Move>
      </s-stack>

      <s-divider />

      <s-stack direction="block" gap="small-200">
        <s-heading>Optional badges</s-heading>
        <s-text color="subdued">
          Reassurance only — nothing to tick, nothing to buy. Each one decides
          for itself when to appear, so read the line under it.
        </s-text>
      </s-stack>
      <SurfaceList surfaces={OPTIONAL} shop={shop} theme={theme} />

      <s-divider />

      <s-stack direction="block" gap="small-200">
        <s-heading>Checkout is separate</s-heading>
        <s-text color="subdued">
          The protection tick box at checkout is not a theme block, and Shopify
          publishes no link that places it. Go to{" "}
          <s-text type="strong">Settings → Checkout</s-text>, press{" "}
          <s-text type="strong">Customize</s-text>, open the{" "}
          <s-text type="strong">Apps</s-text> tab and add Kourify there.
        </s-text>
      </s-stack>

      {/*
        Not "a drawer cannot hold an app block". A drawer built as a section
        group can -- we rebuilt our own test store's that way. Plenty are not,
        and a merchant whose drawer has no Apps slot needs to know that is the
        theme's doing and what to do instead.
      */}
      <s-paragraph color="subdued">
        Many themes put the cart in a slide-out drawer, and most drawers have
        nowhere to add an app block. If yours does not, the cart box goes on
        the cart page, and shoppers who never open that page see the product
        page box instead.
      </s-paragraph>
    </s-stack>
  );
}
