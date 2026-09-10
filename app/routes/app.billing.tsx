import type { LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PageHeader } from "../components/PageHeader";
import { Card } from "../components/Card";
import { AppButton } from "../components/AppButton";
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
  /** Small pill — a real saving, or an honest caveat about the cycle. */
  note?: string;
  features: string[];
  featured?: boolean;
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
      meta: `+ ${money(USAGE_FEE_CENTS)} per protected order`,
      note: annual ? "Billed monthly — usage plans can't be annual" : undefined,
      featured: true,
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
        ? `${money(20000 / 12)} / mo · no per-order fee`
        : "No per-order fee, whatever your volume",
      note: annual ? "Save $40 — 2 months free" : undefined,
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
    <div className="app-plans">
      <div
        className="app-plans__toggle"
        role="group"
        aria-label="Billing cycle"
      >
        <button
          type="button"
          aria-pressed={cycle === "monthly"}
          onClick={() => setCycle("monthly")}
        >
          Monthly
        </button>
        <button
          type="button"
          aria-pressed={cycle === "annual"}
          onClick={() => setCycle("annual")}
        >
          Annual
          <span className="app-plans__save">Save 2 months</span>
        </button>
      </div>

      <div className="app-plans__grid">
        {cards.map((card) => {
          const isCurrent = card.id === activePlan;
          return (
            <div
              key={card.name}
              className={[
                "app-plan",
                card.featured && !isCurrent ? "app-plan--featured" : "",
                isCurrent ? "app-plan--current" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {isCurrent && (
                <span className="app-plan__ribbon">Current plan</span>
              )}
              {!isCurrent && card.featured && (
                <span className="app-plan__ribbon">Most popular</span>
              )}

              <h3 className="app-plan__name">{card.name}</h3>

              <div className="app-plan__price">
                {card.amountCents === null ? (
                  <span className="app-plan__amount">Free</span>
                ) : (
                  <>
                    <span className="app-plan__currency">$</span>
                    <span className="app-plan__amount">
                      {(card.amountCents / 100).toFixed(0)}
                    </span>
                  </>
                )}
                {card.interval && (
                  <span className="app-plan__interval">{card.interval}</span>
                )}
              </div>

              <p className="app-plan__meta">{card.meta}</p>
              {card.note && <span className="app-plan__note">{card.note}</span>}

              <ul className="app-plan__features">
                {card.features.map((feature) => (
                  <li key={feature}>
                    <span className="app-plan__check" aria-hidden="true">
                      ✓
                    </span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="app-plan__cta">
                {isCurrent ? (
                  <AppButton variant="secondary" disabled>
                    Your current plan
                  </AppButton>
                ) : card.id === "basic" ? (
                  <AppButton
                    href="/app/billing/start?plan=basic"
                    variant="secondary"
                    disabled={!hasActiveBilling}
                  >
                    {hasActiveBilling ? "Downgrade to Basic" : "Included"}
                  </AppButton>
                ) : (
                  <AppButton
                    href={`/app/billing/start?plan=${card.id}`}
                    variant={card.featured ? "primary" : "secondary"}
                  >
                    {`Choose ${card.name}`}
                  </AppButton>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="app-plans__footnote">
        Shopify handles the charge and shows you the amount before you approve
        it. You can change or cancel your plan at any time.
      </p>
    </div>
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
    <s-page>
      <PageHeader
        title="Billing"
        subtitle={
          showPlans
            ? "Choose the plan that fits how many orders you protect."
            : "Manage your Kourify subscription through Shopify."
        }
        actions={
          <AppButton href="/app" variant="secondary">
            Back
          </AppButton>
        }
      />

      {!showPlans && (
        <Card heading="Current plan">
          <dl className="app-billing-facts">
            <div>
              <dt>Plan</dt>
              <dd>{plan.name}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{plan.price}</dd>
            </div>
            <div>
              <dt>Billing interval</dt>
              <dd>{plan.interval}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <s-badge tone={hasActiveBilling ? "success" : "neutral"}>
                  {hasActiveBilling ? "Active" : "Free plan"}
                </s-badge>
              </dd>
            </div>
          </dl>
          <div className="app-actions">
            <AppButton
              variant="secondary"
              onClick={() => setSearchParams({ plans: "1" })}
            >
              Change plan
            </AppButton>
          </div>
        </Card>
      )}

      <Card heading="Usage this period">
        <dl className="app-billing-facts">
          <div>
            <dt>Protected orders</dt>
            <dd>{protectedOrders}</dd>
          </div>
          {isBasic && quota.limit !== null && (
            <div>
              <dt>Remaining allowance</dt>
              <dd>{`${quota.remaining} of ${quota.limit}`}</dd>
            </div>
          )}
          {isUsage && (
            <div>
              <dt>Kourify usage fee</dt>
              <dd>{`${money(USAGE_FEE_CENTS)} per protected order`}</dd>
            </div>
          )}
          <div>
            <dt>Usage charges</dt>
            <dd>{money(isUsage ? billedUsageCents : 0)}</dd>
          </div>
        </dl>

        {!isUsage && (
          <s-paragraph>
            {isBasic
              ? "No Kourify usage fee on Basic."
              : "No per-order usage fee on Unlimited."}
          </s-paragraph>
        )}

        {quota.overAllowance && (
          <s-banner tone="warning">
            {`You're over your plan allowance — ${quota.used} protected orders against a limit of ${quota.limit}. Protection a customer already paid for is always honoured, so orders that were mid-checkout when the limit was reached still went through. New merchant-paid coverage is paused until you upgrade.`}
          </s-banner>
        )}

        {quota.exhausted && !quota.overAllowance && (
          <s-banner tone="warning">
            {`You've used all ${quota.limit} protected orders on Basic. Protection is switched off for new orders — existing protected orders keep their coverage and can still be claimed.`}
          </s-banner>
        )}
      </Card>

      {showPlans ? (
        <Card heading="Plans">
          <PlanPicker
            activePlan={activePlan}
            hasActiveBilling={hasActiveBilling}
          />
        </Card>
      ) : (
        <Card heading="Billing information">
          <s-paragraph>
            {`Shopify handles subscription billing and charges your store through Shopify. Kourify never sees or stores your payment details. The ${money(
              USAGE_FEE_CENTS,
            )} usage fee is billed to you per protected order on the Usage plan — it is not the protection price your customers pay, not coverage, and not a claim settlement.`}
          </s-paragraph>
        </Card>
      )}
    </s-page>
  );
}
