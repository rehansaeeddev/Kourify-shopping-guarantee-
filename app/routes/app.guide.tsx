import { type ReactNode } from "react";

import { Card } from "../components/Card";
import { PageBody } from "../components/PageBody";

/**
 * The size a panel draws its own title at.
 *
 * Same trick Card uses: Polaris reads `size` off s-heading at runtime, but
 * the published v1.0 types do not declare it. These panels draw their title
 * beside an icon instead of handing it to Card, so they have to ask.
 */
const PANEL_HEADING = { size: "large-200" } as Record<string, string>;

/**
 * One panel: an icon, a title, a rule, then whatever it explains.
 *
 * Card's own heading sits alone at the top of the box, which is right for a
 * settings card and wrong here -- a manual is scanned by its icons as much
 * as its words, and the rule under the title is what stops a long page
 * reading as one column of prose.
 */
/**
 * Polaris gives icons seven tones and every one of them means something:
 * there is no decorative palette to rotate through. So a panel's colour is
 * chosen for what the panel is about, which leaves some sharing a tone --
 * and leaves warning and critical unused here, because amber and red are
 * already spoken for at the top of this page, where they mean a claim is
 * waiting or was denied. A red question mark beside "FAQ" would read as a
 * problem.
 */
function Panel({
  icon,
  tone = "info",
  heading,
  children,
}: {
  icon: string;
  tone?: "info" | "success" | "caution" | "neutral";
  heading: string;
  children: ReactNode;
}) {
  return (
    <Card boxed>
      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-box background="subdued" borderRadius="large" padding="small-300">
          <s-icon type={icon as never} tone={tone} size="base" />
        </s-box>
        <s-heading {...PANEL_HEADING}>{heading}</s-heading>
      </s-stack>
      <s-divider />
      {children}
    </Card>
  );
}

/** A bullet whose first few words are the thing being defined. */
function Point({ term, children }: { term: string; children: ReactNode }) {
  return (
    <s-stack direction="inline" gap="small-300" alignItems="start">
      <s-text color="subdued">&bull;</s-text>
      <s-text>
        <s-text type="strong">{term}</s-text>
        {" — "}
        {children}
      </s-text>
    </s-stack>
  );
}

/** A numbered step, for the one sequence on this page. */
function Step({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <s-stack direction="inline" gap="small-300" alignItems="start">
      <s-badge tone="neutral">{String(n)}</s-badge>
      <s-stack direction="block" gap="small-500">
        <s-text type="strong">{label}</s-text>
        <s-text color="subdued">{children}</s-text>
      </s-stack>
    </s-stack>
  );
}

/**
 * The lookups.
 *
 * Deliberately short: everything a merchant needs to understand is in the
 * panels above, so what is left here is the "why did that happen" a page of
 * explanation cannot answer in advance. No search over seven entries -- the
 * field would be more to read than the list it filtered, and the browser's
 * own find-in-page already covers a page this size.
 */
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "The trust badge is not showing on my store",
    a: "Two things switch it off: the badge setting in this app, and whether the block is placed in your theme. Check the setting first, then your theme editor — Shopify only lets a merchant place an app block.",
  },
  {
    q: "Protection is not being offered at checkout",
    a: "Usually one of three: protection is switched off, you have used your plan’s protected orders, or the item costs more than your maximum eligible value.",
  },
  {
    q: "A claim was refused before I ever saw it",
    a: "It fell outside the filing window for that reason, or the order it named was never protected. Both are checked before a claim is created, so it never reaches your claims list.",
  },
  {
    q: "The claim page shows the wrong shop name",
    a: "The name in Branding wins over the per-language one. If Branding is blank the page uses the name set for each language instead.",
  },
  {
    q: "Why does one reason ask for a photo and another does not?",
    a: "Photos are required for Arrived damaged and Concealed damage. Those are claims about the condition of goods that did arrive — nothing can be photographed for a parcel that never showed up.",
  },
  {
    q: "Is this insurance?",
    a: "No. Shopping Guarantee is a guarantee you fund and decide yourself. It is not underwritten insurance, and no claim is ever approved automatically.",
  },
  {
    q: "My orders show blank customer names",
    a: "The app has not been granted Protected Customer Data access yet. Grant it in the Partner Dashboard, then run Order sync again.",
  },
];

export default function Guide() {
  return (
    <s-page inlineSize="large" heading="How it works">
      <s-button slot="secondary-actions" href="/app" variant="secondary">
        Back to home
      </s-button>
      <PageBody>
        {/*
          The filled header block.

          `strong` is the darkest surface Polaris offers -- `background` takes
          transparent, subdued, base or strong and nothing else, so a coloured
          one would mean putting the admin stylesheet back, which was
          deliberately removed. This is the same architecture in the palette
          the admin already owns.
        */}
        <s-box background="strong" borderRadius="large" padding="large">
          <s-stack direction="block" gap="small-300">
            <s-heading {...PANEL_HEADING}>
              How Shopping Guarantee works
            </s-heading>
            <s-text>
              Optional order protection your customers buy at checkout &mdash;
              and claims that you decide, not us.
            </s-text>
          </s-stack>
        </s-box>

        {/* The three states, as the colours the admin already uses for them.
          s-banner carries its own tint per tone, so these need no palette of
          their own. */}
        <s-stack direction="block" gap="small-300">
          <s-text type="strong">What a claim can be</s-text>
          <s-grid gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap="base">
            <s-banner tone="warning" heading="Open">
              The customer has filed and sent their evidence. Nothing happens to
              the order until you decide.
            </s-banner>
            <s-banner tone="success" heading="Approved">
              You accepted it. The customer is emailed. How you settle it
              &mdash; refund, replacement, credit &mdash; is between you and
              them.
            </s-banner>
            <s-banner tone="critical" heading="Denied">
              You refused it. The customer is emailed and the claim closes.
            </s-banner>
          </s-grid>
          <s-text color="subdued">
            Every claim carries the reason the customer chose, which item it is
            about, and a photo where one was required.
          </s-text>
        </s-stack>

        <Panel
          icon="cash-dollar"
          tone="info"
          heading="The fee vs what is covered"
        >
          <s-text color="subdued">
            Two different numbers, and the one merchants mix up. One is what you
            charge; the other is what qualifies.
          </s-text>
          <s-stack direction="block" gap="small-300">
            <Point term="The protection fee">
              what the customer pays at checkout to protect the order. A flat
              price, or a percentage of the order on Shopify Plus.
            </Point>
            <Point term="The eligible item value">
              the most an item can cost and still be protected. Anything above
              it is not covered, whatever the customer paid. Shipping and tax
              are never counted.
            </Point>
          </s-stack>
          <s-text color="subdued">
            In short: the fee is your price, the eligible value is your limit.
            Changing one never changes the other.
          </s-text>
        </Panel>

        <Panel
          icon="clipboard-checklist"
          tone="info"
          heading="How a claim reaches you"
        >
          <s-stack direction="block" gap="base">
            <Step n={1} label="Your customer files it">
              From the guarantee tab on your storefront: the order number, the
              email they ordered with, the item, a reason, and a photo where
              that reason needs one.
            </Step>
            <Step n={2} label="Kourify checks your rules">
              The filing window for that reason, and whether the order was
              protected at all. Anything outside is refused there and then.
            </Step>
            <Step n={3} label="You decide it">
              It arrives in Claims with its evidence. Kourify never approves or
              denies on your behalf.
            </Step>
          </s-stack>
        </Panel>

        <s-grid
          gridTemplateColumns="@container (inline-size <= 760px) 1fr, 1fr 1fr"
          gap="base"
          alignItems="start"
        >
          <Panel icon="order" tone="success" heading="Acting on a claim">
            <s-text color="subdued">
              Open any claim to act. Each one closes it.
            </s-text>
            <s-stack direction="block" gap="small-300">
              <Point term="Approve">
                accept it. The customer is emailed; you settle it your way.
              </Point>
              <Point term="Deny">
                refuse it, with a reason the customer receives.
              </Point>
              <Point term="Open the order">
                jump to it in Shopify to refund, replace or restock.
              </Point>
            </s-stack>
          </Panel>

          <Panel icon="globe" tone="success" heading="What your customer gets">
            <s-stack direction="block" gap="small-300">
              <Point term="On filing">
                a confirmation that the claim was received.
              </Point>
              <Point term="On your decision">
                an email either way, approved or denied.
              </Point>
              <Point term="Throughout">
                the claim page in their own language, where you have added one.
              </Point>
            </s-stack>
          </Panel>
        </s-grid>

        <s-grid
          gridTemplateColumns="@container (inline-size <= 760px) 1fr, 1fr 1fr"
          gap="base"
          alignItems="start"
        >
          <Panel icon="color" tone="info" heading="Making the claim page yours">
            <s-stack direction="block" gap="small-300">
              <Point term="Name and logo">
                yours, and you choose whether they sit with the introduction or
                across the top.
              </Point>
              <Point term="Two colours">
                a brand colour and a page background. Every other shade is
                worked out from them.
              </Point>
              <Point term="Your own text">
                a block above the form and one beside it, in your words.
              </Point>
            </s-stack>
            <s-stack direction="inline">
              <s-link href="/app/settings?tab=branding">Open branding</s-link>
            </s-stack>
          </Panel>

          <Panel icon="settings" tone="info" heading="What you control">
            <s-stack direction="block" gap="small-300">
              <Point term="Who pays">the customer at checkout, or you.</Point>
              <Point term="What qualifies">
                the maximum item value, and which of the six reasons you accept.
              </Point>
              <Point term="How long they have">
                a filing window per reason, counted from when the order shipped.
              </Point>
            </s-stack>
            <s-stack direction="inline">
              <s-link href="/app/settings">Open settings</s-link>
            </s-stack>
          </Panel>
        </s-grid>

        <Panel
          icon="shield-check-mark"
          tone="success"
          heading="Where protection appears"
        >
          <s-grid
            gridTemplateColumns="repeat(3, minmax(0, 1fr))"
            gap="base"
            alignItems="start"
          >
            <s-stack direction="block" gap="small-400">
              <s-text type="strong">Product page and cart</s-text>
              <s-text color="subdued">
                App blocks you place in your theme editor. Shopify only lets a
                merchant add them, so this one is yours to do.
              </s-text>
            </s-stack>
            <s-stack direction="block" gap="small-400">
              <s-text type="strong">Checkout</s-text>
              <s-text color="subdued">
                The protection line on eligible orders, priced the way you set
                it.
              </s-text>
            </s-stack>
            <s-stack direction="block" gap="small-400">
              <s-text type="strong">The guarantee tab</s-text>
              <s-text color="subdued">
                Pinned to the edge of your store, carrying your name and logo.
                It opens the claim page.
              </s-text>
            </s-stack>
          </s-grid>
        </Panel>

        <Panel icon="lock" tone="caution" heading="Customer data and privacy">
          <s-text color="subdued">
            A claim needs the order number, the email the order was placed with,
            which item it is about, and a photo where the reason requires one.
            Nothing else is asked for, and no payment details are ever handled
            here.
          </s-text>
          <s-stack direction="block" gap="small-300">
            <Point term="Photos">
              stored on your own Shopify files, not ours.
            </Point>
            <Point term="Blank customer names">
              the app has not been granted Protected Customer Data access yet.
              Grant it in the Partner Dashboard, then run Order sync again.
            </Point>
          </s-stack>
        </Panel>

        <Panel icon="question-circle" tone="info" heading="FAQ">
          <s-stack direction="block" gap="base">
            {FAQ.map((entry, index) => (
              <s-stack key={entry.q} direction="block" gap="small-300">
                {index > 0 ? <s-divider /> : null}
                <s-text type="strong">{entry.q}</s-text>
                <s-text color="subdued">{entry.a}</s-text>
              </s-stack>
            ))}
          </s-stack>
        </Panel>

        <s-paragraph color="subdued">
          Still stuck?{" "}
          <s-link href="mailto:support@kourify.com">
            Email support@kourify.com
          </s-link>
        </s-paragraph>
      </PageBody>
    </s-page>
  );
}
