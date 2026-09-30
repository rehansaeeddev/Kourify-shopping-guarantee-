import { useState } from "react";

import { Card } from "../components/Card";
import { AppButton } from "../components/AppButton";
import { PageError, PageSkeleton } from "../components/PageState";
import { useDashboard } from "../lib/queries";
import { PageBody } from "../components/PageBody";

/**
 * The flow, in three phases, each with the person who acts in it.
 *
 * It was seven numbered labels laid across two columns. A sequence cannot
 * be read in two directions: the eye goes down a column, so it read 1, 3,
 * 5, 7 and then 2, 4, 6 while the numbers said otherwise. And the labels
 * named no one -- "Eligible item becomes protected" has no actor, and
 * "Something goes wrong" is not a step anybody takes.
 *
 * Phases run left to right, steps run down inside one. Both directions
 * mean something now, so neither is ambiguous.
 */
const FLOW: Array<{
  phase: string;
  who: string;
  where: string;
  steps: string[];
}> = [
  {
    phase: "At checkout",
    who: "Your customer",
    where: "On your storefront",
    steps: [
      "They tick protection on their order.",
      "They pay the fee, or you cover it \u2014 whichever you chose.",
      "Every eligible item on that order is now covered.",
    ],
  },
  {
    phase: "If something goes wrong",
    who: "Your customer",
    where: "On your storefront",
    steps: [
      "They open the claim page from the tab on your store.",
      "They pick the item, say what happened, attach a photo.",
      "You get an email that a claim came in.",
    ],
  },
  {
    phase: "Deciding it",
    who: "You",
    where: "Here, in this app",
    steps: [
      "Kourify checks it against the rules you set and shows you the evidence.",
      "You approve or deny it. Kourify never decides for you.",
      "Your customer is emailed either way.",
    ],
  },
];

/**
 * The manual.
 *
 * Not a setup guide: the dashboard already has one, with the same steps and
 * the same buttons, and a second copy of it here was the mistake this page
 * was rejected for twice. A setup guide answers "how do I start". A manual
 * answers "how does this work" and "why did that happen", which is what a
 * merchant needs once they are already running.
 *
 * Every answer here is what the code does, not what would be nice. Where a
 * rule has a number in it, the number is the merchant's own setting and the
 * answer says so rather than inventing one.
 */
const MANUAL: Array<{
  group: string;
  entries: Array<{ q: string; a: string; href?: string; link?: string }>;
}> = [
  {
    group: "Protection and pricing",
    entries: [
      {
        q: "Who pays for protection?",
        a: "You choose. With Customer pays, the shopper pays the protection fee at checkout. With Merchant pays, protection is free for them and the cost is yours.",
        href: "/app/settings",
        link: "Pricing settings",
      },
      {
        q: "Can I charge a percentage of the order instead of a flat fee?",
        a: "Only on Shopify Plus. A percentage fee is applied by a Cart Transform, which Shopify runs on Plus stores only. On any other plan the flat price is used.",
      },
      {
        q: "What makes an item eligible?",
        a: "Your coverage settings. You set a maximum eligible item value and anything priced above it is not protected. Shipping and tax are never counted as covered merchandise.",
        href: "/app/settings",
        link: "Coverage settings",
      },
      {
        q: "What happens when I run out of protected orders?",
        a: "Protection stops being offered on new orders. Orders already protected keep their coverage and their customers can still file claims.",
        href: "/app/billing",
        link: "See your plan",
      },
      {
        q: "Is this insurance?",
        a: "No. Shopping Guarantee is a guarantee you fund and decide yourself. It is not underwritten insurance, and no claim is ever approved automatically.",
      },
    ],
  },
  {
    group: "Your storefront",
    entries: [
      {
        q: "Where do shoppers see protection?",
        a: "On the product page and in the cart, through app blocks you add in your theme editor, and as the trust badge. The blocks are not added for you \u2014 Shopify only lets a merchant place them.",
      },
      {
        q: "What is the guarantee tab?",
        a: "The tab pinned to the edge of your storefront. It opens a short explanation and a link to the claim page. It carries your shop name and logo once you set them, and you choose which edge it sits on.",
        href: "/app/settings",
        link: "Tab position",
      },
      {
        q: "Can I make the claim page look like my store?",
        a: "Yes. Set your shop name, logo and two colours, choose where the name and the introduction sit, and add your own text above the form or beside it. Everything else on the page is shaded from your brand colour.",
        href: "/app/settings?tab=branding",
        link: "Branding",
      },
      {
        q: "Can the claim page be in another language?",
        a: "Yes. Add a language and translate its strings; shoppers get a picker on the page. Text you wrote yourself shows in your default language until you translate it too.",
        href: "/app/settings?tab=languages",
        link: "Languages",
      },
    ],
  },
  {
    group: "Claims",
    entries: [
      {
        q: "How does a customer file a claim?",
        a: "From the guarantee tab on your storefront. They enter the order number and the email they ordered with, pick the affected item, choose a reason, and attach a photo where one is required.",
      },
      {
        q: "Which reasons need a photo?",
        a: "Arrived damaged and Concealed damage. Those are claims about the condition of goods that did arrive; nothing can be photographed for a parcel that never showed up, so the other reasons do not ask for one.",
      },
      {
        q: "How long does a customer have to file?",
        a: "The window you set for each reason, counted from when the order actually shipped. Each of the six reasons has its own window, and a claim outside it is refused before it reaches you.",
        href: "/app/settings",
        link: "Claim windows",
      },
      {
        q: "Who decides a claim?",
        a: "You do. Kourify checks the claim against the rules you configured and puts it in front of you with its evidence, but never approves or denies on your behalf.",
        href: "/app/claims",
        link: "Open claims",
      },
      {
        q: "What does the customer get told?",
        a: "They are emailed when the claim is received and again when you decide it, either way.",
      },
    ],
  },
  {
    group: "When something looks wrong",
    entries: [
      {
        q: "The trust badge is not showing on my store",
        a: "Two things switch it off: the badge setting in this app, and whether the block is placed in your theme. Check the setting first, then your theme editor.",
        href: "/app/settings",
        link: "Badge settings",
      },
      {
        q: "Protection is not being offered at checkout",
        a: "Usually one of three: protection is switched off, you have used your plan\u2019s protected orders, or the item costs more than your maximum eligible value.",
        href: "/app/settings",
        link: "Check settings",
      },
      {
        q: "A claim was refused before I saw it",
        a: "It fell outside the filing window for that reason, or the order it named was never protected. Both are checked before a claim is created, so it never reaches your claims list.",
      },
      {
        q: "The claim page shows the wrong shop name",
        a: "The name in Branding wins over the per-language one. If Branding is blank the page uses the name set for each language instead.",
        href: "/app/settings?tab=branding",
        link: "Branding",
      },
    ],
  },
];

export default function Guide() {
  /*
   * The dashboard's payload already carries everything this page reads,
   * and both are usually visited in the same sitting — so this shares its
   * cache rather than asking the backend the same questions again.
   */
  const { data, isPending, error, refetch } = useDashboard();
  const [query, setQuery] = useState("");

  if (isPending) return <PageSkeleton heading="Help &amp; getting started" />;
  if (error)
    return (
      <PageError
        heading="Help &amp; getting started"
        error={error}
        onRetry={refetch}
      />
    );

  const { quota } = data;

  /*
   * The search narrows the manual rather than hiding it behind disclosures.
   * Matching the answer as well as the question matters: a merchant searches
   * for the word in front of them -- "photo", "Plus", "window" -- which is
   * rarely the word a question is titled with.
   */
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? MANUAL.map((group) => ({
        ...group,
        entries: group.entries.filter((entry) =>
          `${entry.q} ${entry.a}`.toLowerCase().includes(needle),
        ),
      })).filter((group) => group.entries.length > 0)
    : MANUAL;

  return (
    <s-page inlineSize="large" heading="Help &amp; getting started">
      <s-button slot="secondary-actions" href="/app" variant="secondary">
        Back to home
      </s-button>
      <PageBody>
        {quota.exhausted && (
          <s-banner tone="warning" heading="Protection is switched off">
            {`You've used all ${quota.limit} protected orders on your current plan. Orders already protected keep their coverage and can still be claimed.`}
            <AppButton
              slot="secondary-actions"
              variant="secondary"
              href="/app/billing"
            >
              View billing
            </AppButton>
          </s-banner>
        )}

        {/*
          What the app is, before anything a merchant has to do about it.
          This used to be a green gradient banner of our own -- a second page
          title in a colour the admin does not use, above a card that then
          repeated the same seven steps. One card now, boxed so it starts
          level with the page rather than a heading lower.
        */}
        <Card heading="How Shopping Guarantee works" boxed>
          <s-paragraph>
            Offer optional order protection at checkout. When something goes
            wrong, the customer files a claim from your storefront and you
            decide it.
          </s-paragraph>
          {/* Phases across, steps down. Three columns rather than seven
            items in two, because the columns are the phases -- reading
            across is the flow and reading down is what happens within one,
            so both directions carry meaning. On a narrow window they stack,
            which keeps the single reading order a sequence needs. */}
          <s-grid
            gridTemplateColumns="@container (inline-size <= 860px) 1fr, 1fr 1fr 1fr"
            gap="base"
          >
            {FLOW.map((phase, index) => (
              <s-box
                key={phase.phase}
                padding="base"
                borderWidth="base"
                borderColor="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small-300">
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-badge tone="neutral">{String(index + 1)}</s-badge>
                    <s-text type="strong">{phase.phase}</s-text>
                  </s-stack>
                  {/* Who acts, and where. This is the thing the old list
                    left out entirely, and the reason it read as a set of
                    events happening to nobody in particular. */}
                  <s-stack direction="block" gap="small-500">
                    <s-text color="subdued">{phase.who}</s-text>
                    <s-text color="subdued">{phase.where}</s-text>
                  </s-stack>
                  <s-divider />
                  <s-stack direction="block" gap="small-300">
                    {phase.steps.map((step) => (
                      <s-text key={step}>{step}</s-text>
                    ))}
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-grid>
          <s-banner tone="info">
            Shopping Guarantee is a self-funded, manually reviewed guarantee. It
            is not underwritten insurance, and claims are never approved
            automatically.
          </s-banner>
        </Card>

        {/* A manual, searchable, because that is how one gets used: a
          merchant arrives with a question, not with a wish to read. There is
          no disclosure component in this Polaris version, so the answers sit
          open and the field narrows the page instead of collapsing it --
          which also leaves the browser's own find-in-page working. */}
        <Card heading="How it all works" boxed>
          <s-search-field
            label="Search"
            labelAccessibilityVisibility="exclusive"
            placeholder="Search the manual"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value ?? "")}
          />

          {matches.length === 0 ? (
            <s-text color="subdued">
              {`Nothing here matches \u201c${query}\u201d. Email support and we will answer it \u2014 and add it.`}
            </s-text>
          ) : null}

          <s-stack direction="block" gap="large">
            {matches.map((group) => (
              <s-stack key={group.group} direction="block" gap="base">
                <s-text type="strong">{group.group}</s-text>
                {group.entries.map((entry, index) => (
                  <s-stack key={entry.q} direction="block" gap="small-300">
                    {index > 0 ? <s-divider /> : null}
                    <s-text type="strong">{entry.q}</s-text>
                    <s-text color="subdued">{entry.a}</s-text>
                    {entry.href ? (
                      <s-stack direction="inline">
                        <s-link href={entry.href}>{entry.link}</s-link>
                      </s-stack>
                    ) : null}
                  </s-stack>
                ))}
              </s-stack>
            ))}
          </s-stack>
        </Card>

        {/* App Home's footer-help composition: the way out of the page, kept
          quiet at the bottom rather than made into another card. */}
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
