import type { LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { DEFAULT_CLAIM_WINDOWS } from "../lib/claim-window";
import { getBillingState } from "../lib/billing-state.server";
import { getProtectionQuota } from "../lib/plan-limits.server";
import { BASIC_PROTECTED_ORDER_LIMIT, type PlanId } from "../lib/plans";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  const settings = await db.merchantSettings.upsert({
    where: { shop: session.shop },
    update: {},
    create: {
      shop: session.shop,
      claimWindows: JSON.stringify(DEFAULT_CLAIM_WINDOWS),
    },
  });

  // Shopify is the billing authority. The local `plan` column is only a
  // mirror, refreshed here from the verified subscription — never from the
  // browser, form data or a URL parameter.
  const { hasActiveBilling, activePlan } = await getBillingState(billing);
  if (settings.plan !== activePlan) {
    await db.merchantSettings.update({
      where: { shop: session.shop },
      data: { plan: activePlan },
    });
  }

  const quota = await getProtectionQuota(session.shop, activePlan);
  const protectedOrders = await db.protectedOrder.count({
    where: { shop: session.shop, revokedAt: null },
  });
  // Only events actually charged — pending/waived/reversed would overstate it.
  const billedUsage = await db.usageEvent.aggregate({
    where: { shop: session.shop, status: "billed" },
    _sum: { amountCents: true },
  });

  return {
    activePlan,
    hasActiveBilling,
    quota,
    protectedOrders,
    billedUsageCents: billedUsage._sum.amountCents ?? 0,
  };
};
function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type BillingCycle = "monthly" | "annual";

type PlanCard = {
  /** Plan the CTA subscribes to — matches app.billing.start's `plan` param. */
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
}: {
  activePlan: PlanId;
  hasActiveBilling: boolean;
}) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const cards = planCards(cycle);

  return (
    <s-stack direction="block" gap="base">
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
        <s-choice value="annual">Annual — save two months on Unlimited</s-choice>
      </s-choice-list>

      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))"
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

                <s-stack direction="inline" gap="small-200" alignItems="baseline">
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
                    href={`/app/billing/start?plan=${card.id}`}
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
  const {
    activePlan,
    hasActiveBilling,
    quota,
    protectedOrders,
    billedUsageCents,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const plan = PLAN_SUMMARY[activePlan];
  const isUsage = activePlan === "usage";
  const isBasic = activePlan === "basic";

  // Before a merchant subscribes there is no status worth leading with, so the
  // page opens on the plans. Once they're paying, status leads and the plans
  // move behind an explicit "Change plan".
  const showPlans = !hasActiveBilling || searchParams.get("plans") === "1";

  return (
    <s-page heading="Billing">
      <s-button slot="secondary-actions" href="/app" variant="secondary">
        Back
      </s-button>

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
    </s-page>
  );
}
