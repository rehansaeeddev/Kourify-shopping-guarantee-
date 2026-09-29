import { useState } from "react";
import { useSearchParams } from "react-router";
import { PageError, PageSkeleton } from "../components/PageState";
import { useBilling, useSubscribe } from "../lib/queries";
import { useToast } from "../components/Toast";
import { BASIC_PROTECTED_ORDER_LIMIT, type PlanId } from "../lib/plans";
import { PageBody } from "../components/PageBody";

/**
 * Per-order Kourify usage charge on the Usage plan. Billed to the *merchant*.
 * Distinct from the protection price a customer may pay, from coverage, and
 * from any claim settlement — those live in Settings, not here.
 */
const USAGE_FEE_CENTS = 60;

const PLAN_SUMMARY: Record<
  PlanId,
  { name: string; price: string; interval: string }
> = {
  basic: { name: "Basic", price: "Free", interval: "—" },
  usage: { name: "Usage", price: "$10.00", interval: "Every 30 days" },
  unlimited: { name: "Unlimited", price: "$20.00", interval: "Every 30 days" },
  unlimited_annual: { name: "Unlimited", price: "$200.00", interval: "Annual" },
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type BillingCycle = "monthly" | "annual";

type PlanCard = {
  /** Plan the CTA subscribes to — the `plan` body field on /billing/subscribe. */
  id: PlanId;
  name: string;
  /** null renders as "Free" rather than "$0". */
  amountCents: number | null;
  interval: string;
  /** Sub-line under the price: what the number actually buys. */
  meta: string;
  /** A real saving, or an honest caveat about the cycle. */
  note?: string;
  features: string[];
  recommended?: boolean;
};

/**
 * Only Unlimited has an annual price. Shopify's Billing API can't put a
 * usage-based charge on an ANNUAL interval, and Basic is free either way — so
 * the cycle switch relabels Unlimited and annotates the other two instead of
 * pretending all three have two prices.
 */
function planCards(cycle: BillingCycle): PlanCard[] {
  const annual = cycle === "annual";

  return [
    {
      id: "basic",
      name: "Basic",
      amountCents: null,
      interval: "",
      meta: `Up to ${BASIC_PROTECTED_ORDER_LIMIT} protected orders`,
      features: [
        `${BASIC_PROTECTED_ORDER_LIMIT} protected orders, then protection pauses`,
        "Protection is merchant-funded on this plan",
        "Customer claims portal with email updates",
        "Trust badges on your storefront",
      ],
    },
    {
      id: "usage",
      name: "Usage",
      amountCents: 1000,
      interval: "/ month",
      meta: `Plus ${money(USAGE_FEE_CENTS)} per protected order`,
      note: annual ? "Billed monthly — usage plans can't be annual" : undefined,
      recommended: true,
      features: [
        "No cap on protected orders",
        "Charge the customer, or cover protection yourself",
        "You only pay for orders you actually protect",
        "Customer claims portal with email updates",
        "Trust badges on your storefront",
      ],
    },
    {
      id: annual ? "unlimited_annual" : "unlimited",
      name: "Unlimited",
      amountCents: annual ? 20000 : 2000,
      interval: annual ? "/ year" : "/ month",
      meta: annual
        ? `${money(20000 / 12)} a month, no per-order fee`
        : "No per-order fee, whatever your volume",
      note: annual ? "Save $40 — two months free" : undefined,
      features: [
        "Everything in Usage",
        `No ${money(USAGE_FEE_CENTS)} per-order usage fee`,
        "Flat, predictable cost at any volume",
      ],
    },
  ];
}

function PlanPicker({
  activePlan,
  hasActiveBilling,
  onChoose,
  pendingPlan,
  errorMessage,
}: {
  activePlan: PlanId;
  hasActiveBilling: boolean;
  onChoose: (plan: PlanId) => void;
  /** The plan whose subscribe call is in flight, if any. */
  pendingPlan: PlanId | null;
  errorMessage: string | null;
}) {
  /*
   * Opened on the merchant's own cycle rather than always monthly. An annual
   * subscriber landing on monthly sees no card carrying their plan — nothing
   * is badged "Current plan", and the one obvious button on the Unlimited
   * card would move them from $200 a year to $20 a month.
   */
  const [cycle, setCycle] = useState<BillingCycle>(
    activePlan === "unlimited_annual" ? "annual" : "monthly",
  );
  const cards = planCards(cycle);

  return (
    <s-stack direction="block" gap="base">
      {errorMessage && (
        <s-banner tone="critical" heading="Could not start this plan change">
          <s-paragraph>{errorMessage}</s-paragraph>
        </s-banner>
      )}

      <s-choice-list
        label="Billing cycle"
        name="cycle"
        values={[cycle]}
        onChange={(event: { currentTarget: { values?: string[] } }) => {
          const next = event.currentTarget.values?.[0];
          if (next === "monthly" || next === "annual") setCycle(next);
        }}
      >
        <s-choice value="monthly">Monthly</s-choice>
        <s-choice value="annual">
          Annual — save two months on Unlimited
        </s-choice>
      </s-choice-list>

      {/* Three equal columns rather than auto-fit: auto-fit dropped Unlimited
          onto a second row on its own, and plans only compare side by side. */}
      <s-grid
        gridTemplateColumns="repeat(3, minmax(0, 1fr))"
        gap="base"
        alignItems="stretch"
      >
        {cards.map((card) => {
          const isCurrent = card.id === activePlan;
          return (
            <s-box
              key={card.name}
              padding="base"
              border="base"
              borderRadius="base"
              background={isCurrent ? "subdued" : undefined}
            >
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-heading>{card.name}</s-heading>
                  {isCurrent && <s-badge tone="success">Current plan</s-badge>}
                  {!isCurrent && card.recommended && (
                    <s-badge tone="info">Recommended</s-badge>
                  )}
                </s-stack>

                <s-stack
                  direction="inline"
                  gap="small-200"
                  alignItems="baseline"
                >
                  <s-text type="strong" fontVariantNumeric="tabular-nums">
                    {card.amountCents === null
                      ? "Free"
                      : money(card.amountCents)}
                  </s-text>
                  {card.interval && (
                    <s-text color="subdued">{card.interval}</s-text>
                  )}
                </s-stack>

                <s-paragraph color="subdued">{card.meta}</s-paragraph>
                {card.note && <s-badge tone="info">{card.note}</s-badge>}

                <s-unordered-list>
                  {card.features.map((feature) => (
                    <s-list-item key={feature}>{feature}</s-list-item>
                  ))}
                </s-unordered-list>

                {isCurrent ? (
                  <s-button variant="secondary" disabled>
                    Your current plan
                  </s-button>
                ) : card.id === "basic" && !hasActiveBilling ? (
                  <s-button variant="secondary" disabled>
                    Included
                  </s-button>
                ) : (
                  <s-button
                    onClick={() => onChoose(card.id)}
                    loading={pendingPlan === card.id}
                    /* One approval at a time: a second click while Shopify is
                       minting a confirmation URL would open the wrong one. */
                    disabled={pendingPlan !== null}
                    variant={card.recommended ? "primary" : "secondary"}
                  >
                    {card.id === "basic"
                      ? "Downgrade to Basic"
                      : `Choose ${card.name}`}
                  </s-button>
                )}
              </s-stack>
            </s-box>
          );
        })}
      </s-grid>

      <s-paragraph color="subdued">
        Shopify handles the charge and shows you the amount before you approve
        it. You can change or cancel your plan at any time.
      </s-paragraph>
    </s-stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <s-stack direction="block" gap="small-500">
      <s-text color="subdued">{label}</s-text>
      <s-text type="strong" fontVariantNumeric="tabular-nums">
        {value}
      </s-text>
    </s-stack>
  );
}

export default function Billing() {
  const { data, isPending, error, refetch } = useBilling();
  const subscribe = useSubscribe();
  const [searchParams, setSearchParams] = useSearchParams();
  const [chooseError, setChooseError] = useState<string | null>(null);
  const { showToast } = useToast();

  if (isPending) return <PageSkeleton heading="Billing" />;
  if (error)
    return <PageError heading="Billing" error={error} onRetry={refetch} />;

  const {
    hasActiveBilling,
    quota,
    protectedOrders,
    billedUsageCents,
    testMode,
  } = data;

  // The backend types this as a string; only these four ever come back, and
  // an unrecognised one falls back to Basic rather than rendering `undefined`.
  const activePlan = (data.activePlan as PlanId) ?? "basic";
  const plan = PLAN_SUMMARY[activePlan] ?? PLAN_SUMMARY.basic;

  function choosePlan(next: PlanId) {
    setChooseError(null);

    subscribe.mutate(
      { plan: next },
      {
        onSuccess: (result) => {
          /*
           * Shopify's approval screen can't render inside the embedded
           * iframe — it has to take over the top frame. App Bridge patches
           * window.open so `_top` escapes the frame instead of being blocked.
           */
          if (result.confirmationUrl) {
            window.open(result.confirmationUrl, "_top");
            return;
          }

          /*
           * Basic is free, so there is nothing to approve: the backend
           * cancels the subscription and answers ok with an empty URL.
           * Reading that empty string as a missing link told the merchant
           * their downgrade had failed after it had already gone through.
           */
          if (result.ok) {
            showToast("You're now on the Basic plan.");
            return;
          }

          setChooseError(
            result.error ??
              "Shopify did not return an approval link. Try again in a moment.",
          );
        },
      },
    );
  }
  const isUsage = activePlan === "usage";
  const isBasic = activePlan === "basic";

  // Before a merchant subscribes there is no status worth leading with, so the
  // page opens on the plans. Once they're paying, status leads and the plans
  // move behind an explicit "Change plan".
  const showPlans = !hasActiveBilling || searchParams.get("plans") === "1";

  return (
    <s-page inlineSize="large" heading="Billing">
      <s-button slot="secondary-actions" href="/app" variant="secondary">
        Back
      </s-button>
      <PageBody>
        {testMode && (
          <s-banner tone="info" heading="Test billing is on">
            <s-paragraph>
              Subscriptions created here are Shopify test charges — nothing is
              actually billed. This is set on the server, not from this page.
            </s-paragraph>
          </s-banner>
        )}

        {!showPlans && (
          <s-section heading="Current plan">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
              gap="base"
            >
              <Stat label="Plan" value={plan.name} />
              <Stat label="Price" value={plan.price} />
              <Stat label="Billing interval" value={plan.interval} />
              <s-stack direction="block" gap="small-500">
                <s-text color="subdued">Status</s-text>
                <s-stack direction="inline">
                  <s-badge tone={hasActiveBilling ? "success" : "neutral"}>
                    {hasActiveBilling ? "Active" : "Free plan"}
                  </s-badge>
                </s-stack>
              </s-stack>
            </s-grid>

            <s-button
              variant="secondary"
              onClick={() => setSearchParams({ plans: "1" })}
            >
              Change plan
            </s-button>
          </s-section>
        )}

        <s-section heading="Usage this period">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
            gap="base"
          >
            <Stat label="Protected orders" value={String(protectedOrders)} />
            {isUsage && (
              <Stat
                label="Kourify usage fee"
                value={`${money(USAGE_FEE_CENTS)} per order`}
              />
            )}
            <Stat
              label="Usage charges"
              value={money(isUsage ? billedUsageCents : 0)}
            />
            {isBasic && quota.limit !== null && (
              <Stat
                label="Allowance used"
                value={`${quota.used} of ${quota.limit}`}
              />
            )}
          </s-grid>

          {!isUsage && (
            <s-paragraph color="subdued">
              {isBasic
                ? "No Kourify usage fee on Basic."
                : "No per-order usage fee on Unlimited."}
            </s-paragraph>
          )}

          {quota.overAllowance && (
            <s-banner tone="warning" heading="Over your plan allowance">
              {`${quota.used} protected orders against a limit of ${quota.limit}. Protection a customer already paid for is always honoured, so orders that were mid-checkout when the limit was reached still went through. New merchant-paid coverage is paused until you upgrade.`}
            </s-banner>
          )}

          {quota.exhausted && !quota.overAllowance && (
            <s-banner tone="warning" heading="Allowance used up">
              {`You've used all ${quota.limit} protected orders on Basic. Protection is switched off for new orders — existing protected orders keep their coverage and can still be claimed.`}
            </s-banner>
          )}
        </s-section>

        {showPlans ? (
          <s-section heading="Plans">
            <PlanPicker
              activePlan={activePlan}
              hasActiveBilling={hasActiveBilling}
              onChoose={choosePlan}
              pendingPlan={
                subscribe.isPending
                  ? ((subscribe.variables?.plan as PlanId) ?? null)
                  : null
              }
              errorMessage={
                chooseError ??
                (subscribe.error ? subscribe.error.message : null)
              }
            />
          </s-section>
        ) : (
          <s-section heading="Billing information">
            <s-paragraph>
              {`Shopify handles subscription billing and charges your store through Shopify. Kourify never sees or stores your payment details. The ${money(
                USAGE_FEE_CENTS,
              )} usage fee is billed to you per protected order on the Usage plan — it is not the protection price your customers pay, not coverage, and not a claim settlement.`}
            </s-paragraph>
          </s-section>
        )}
      </PageBody>
    </s-page>
  );
}
