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

const FAQ: Array<[string, string]> = [
  [
    "Is this insurance?",
    "No. Shopping Guarantee is a self-funded, manually reviewed guarantee you offer and fund yourself. It is not underwritten insurance.",
  ],
  [
    "Who pays for protection?",
    "You choose. With Customer pays, the customer pays the protection fee at checkout. With Merchant pays, protection is free for the customer and you cover the cost.",
  ],
  [
    "What is the protection price?",
    "It's what's charged for protection — a flat price per order, or a percentage of order value. It is not the amount an item is covered for; those are separate settings.",
  ],
  [
    "What determines item eligibility?",
    "Your coverage settings. You set the maximum eligible item value, and items priced above it aren't protected. Shipping and tax are excluded from covered merchandise value.",
  ],
  [
    "How does a customer submit a claim?",
    "From the guarantee tab on your storefront. They confirm the order, pick the affected item, choose a reason, and attach a photo where one is required.",
  ],
  [
    "Who decides a claim?",
    "You do. Kourify checks the eligibility rules you configured and presents the claim with its evidence, but never approves or denies on your behalf.",
  ],
  [
    "When can a customer submit a claim?",
    "Within the filing window you set for each reason, measured from when the order actually shipped. Claims outside that window are rejected automatically.",
  ],
];

export default function Guide() {
  /*
   * The dashboard's payload already carries everything this page reads,
   * and both are usually visited in the same sitting — so this shares its
   * cache rather than asking the backend the same questions again.
   */
  const { data, isPending, error, refetch } = useDashboard();

  if (isPending) return <PageSkeleton heading="Help &amp; getting started" />;
  if (error)
    return (
      <PageError
        heading="Help &amp; getting started"
        error={error}
        onRetry={refetch}
      />
    );

  const { hasActiveBilling, quota, openClaims } = data;
  const protectionEnabled = Boolean(data.settings.protectionEnabled);
  const badgesEnabled = Boolean(data.settings.badgesEnabled);

  // Three real states, derived from what actually stops protection running.
  const state = quota.exhausted
    ? "limit"
    : protectionEnabled
      ? "active"
      : "setup";

  return (
    <s-page inlineSize="large" heading="Help &amp; getting started">
      <s-button slot="secondary-actions" href="/app" variant="secondary">
        Back to home
      </s-button>
      <PageBody>
        {state === "limit" && (
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

        {state === "setup" && (
          <Card heading="Finish setup">
            <s-paragraph color="subdued">
              Three things to do before protection goes live.
            </s-paragraph>
            <s-stack direction="block" gap="base">
              {[
                {
                  label: "Configure protection",
                  detail:
                    "Choose who pays, set pricing, and define what's eligible.",
                  action: { label: "Open settings", href: "/app/settings" },
                },
                {
                  label: "Add storefront blocks",
                  detail:
                    "Add the protection widget and trust badge in your Shopify theme editor.",
                  action: { label: "Badge settings", href: "/app/settings" },
                },
                {
                  label: "Turn on protection",
                  detail:
                    "Switch on protection at checkout from Settings \u2192 General.",
                  action: { label: "Turn it on", href: "/app/settings" },
                },
              ].map((step, index) => (
                <s-stack key={step.label} direction="block" gap="small-300">
                  {index > 0 ? <s-divider /> : null}
                  <s-grid
                    gridTemplateColumns="@container (inline-size <= 560px) 1fr, 1fr auto"
                    gap="base"
                    alignItems="center"
                  >
                    <s-stack direction="block" gap="small-400">
                      <s-stack
                        direction="inline"
                        gap="small-200"
                        alignItems="center"
                      >
                        <s-badge>{String(index + 1)}</s-badge>
                        <s-text type="strong">{step.label}</s-text>
                      </s-stack>
                      <s-text color="subdued">{step.detail}</s-text>
                    </s-stack>
                    <s-stack direction="inline">
                      <s-button href={step.action.href} variant="secondary">
                        {step.action.label}
                      </s-button>
                    </s-stack>
                  </s-grid>
                </s-stack>
              ))}
            </s-stack>
          </Card>
        )}

        {state === "active" && (
          <Card heading="Your protection is active">
            {/* The badge is the same one the dashboard's status card uses, so
              "live" looks the same wherever a merchant meets it. */}
            <s-stack direction="inline">
              <s-badge tone="success" icon="check-circle">
                Live
              </s-badge>
            </s-stack>
            <s-paragraph color="subdued">
              {`Shopping Guarantee is available for eligible orders.${
                quota.limit !== null
                  ? ` You've protected ${quota.used} of ${quota.limit} orders on your plan.`
                  : ""
              }`}
            </s-paragraph>
          </Card>
        )}

        {/* The part of this page a merchant uses rather than reads. Tiles
          rather than a column of links: five underlined sentences in a list
          gave nothing to aim at and nothing to tell one from another. */}
        <Card heading="Common tasks">
          <s-grid
            gridTemplateColumns="@container (inline-size <= 640px) 1fr, 1fr 1fr"
            gap="base"
          >
            {[
              {
                href: "/app/settings",
                icon: "settings",
                label: "Protection settings",
                detail: "Who pays, pricing and what is eligible",
              },
              {
                href: "/app/claims",
                icon: "clipboard-checklist",
                label: "Claims",
                /* A count belongs beside the name, not inside it: "Claims (2)"
                  reads as the tile's title and gives the number no weight of
                  its own, which is the one thing on this tile a merchant is
                  scanning for. */
                badge: openClaims > 0 ? `${openClaims} open` : null,
                detail: "Review and decide what customers have filed",
              },
              {
                href: "/app/orders",
                icon: "order",
                label: "Orders",
                detail: "See what is protected, or offer it after purchase",
              },
              {
                href: "/app/settings",
                icon: "globe",
                label: "Languages",
                detail: "Translate the storefront claim form",
              },
              {
                href: "/app/billing",
                icon: "cash-dollar",
                label: hasActiveBilling ? "Your plan" : "Choose a plan",
                detail: "What you pay and how much is included",
              },
            ].map((task) => (
              <s-clickable
                key={task.label}
                href={task.href}
                padding="base"
                borderWidth="base"
                borderColor="base"
                borderRadius="large"
                accessibilityLabel={`${task.label}. ${task.detail}`}
              >
                <s-stack direction="block" gap="small-400">
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-icon
                      type={task.icon as never}
                      tone="neutral"
                      size="base"
                    />
                    <s-text type="strong">{task.label}</s-text>
                    {task.badge ? (
                      <s-badge tone="warning">{task.badge}</s-badge>
                    ) : null}
                  </s-stack>
                  <s-text color="subdued">{task.detail}</s-text>
                </s-stack>
              </s-clickable>
            ))}
          </s-grid>
        </Card>

        <Card heading="Questions">
          {/* A rule between entries, so a run of question/answer pairs reads
            as separate items rather than one wall of text. */}
          <s-stack direction="block" gap="base">
            {FAQ.map(([question, answer], index) => (
              <s-stack key={question} direction="block" gap="small-300">
                {index > 0 && <s-divider />}
                <s-text type="strong">{question}</s-text>
                <s-text color="subdued">{answer}</s-text>
              </s-stack>
            ))}
          </s-stack>
        </Card>

        {!badgesEnabled && state !== "setup" && (
          <s-banner tone="info">
            Trust badges are switched off, so shoppers don&apos;t see them on
            your storefront.{" "}
            <s-link href="/app/settings">Turn them on in Settings.</s-link>
          </s-banner>
        )}

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
