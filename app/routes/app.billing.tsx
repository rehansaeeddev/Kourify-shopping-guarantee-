import type { LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";
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
  /** Drives the card's colour. Annual and monthly Unlimited share one tier. */
  tier: "basic" | "usage" | "unlimited";
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
      tier: "basic",
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
      tier: "usage",
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
      tier: "unlimited",
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
      <div className="app-plans__toggle" role="group" aria-label="Billing cycle">
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
          const className = [
            "app-plans__card",
            `app-plans__card--t-${card.tier}`,
            card.featured && !isCurrent ? "app-plans__card--featured" : "",
            isCurrent ? "app-plans__card--current" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={card.name} className={className}>
              {(isCurrent || card.featured) && (
                <span className="app-plans__ribbon">
                  {isCurrent ? "Current plan" : "Most popular"}
                </span>
              )}

              <h3 className="app-plans__name">{card.name}</h3>

              <div className="app-plans__price">
                {card.amountCents === null ? (
                  <span className="app-plans__amount">Free</span>
                ) : (
                  <>
                    <span className="app-plans__currency">$</span>
                    <span className="app-plans__amount">
                      {(card.amountCents / 100).toFixed(0)}
                    </span>
                  </>
                )}
                {card.interval && (
                  <span className="app-plans__interval">{card.interval}</span>
                )}
              </div>

              <p className="app-plans__meta">{card.meta}</p>
              {card.note && (
                <span className="app-plans__note">{card.note}</span>
              )}

              <ul className="app-plans__features">
                {card.features.map((feature) => (
                  <li key={feature}>
                    <span className="app-plans__check" aria-hidden="true">
                      ✓
                    </span>
                    <span className="app-plans__feature-text">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="app-plans__cta">
                {isCurrent ? (
                  <span className="app-plans__btn app-plans__btn--static">
                    Your current plan
                  </span>
                ) : card.id === "basic" && !hasActiveBilling ? (
                  <span className="app-plans__btn app-plans__btn--static">
                    Included
                  </span>
                ) : (
                  <Link
                    className={`app-plans__btn app-plans__btn--${
                      card.featured ? "primary" : "ghost"
                    }`}
                    to={`/app/billing/start?plan=${card.id}`}
                  >
                    {card.id === "basic"
                      ? "Downgrade to Basic"
                      : `Choose ${card.name}`}
                  </Link>
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

/** Allowance spent, as a bar. Only capped plans have something to meter. */
function AllowanceMeter({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const tone = pct >= 100 ? "full" : pct >= 80 ? "warn" : "ok";

  return (
    <div className="app-meter">
      <div className="app-meter__head">
        <span className="app-meter__label">Protected orders used</span>
        <span className="app-meter__value">{`${used} of ${limit}`}</span>
      </div>
      <div
        className="app-meter__track"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label="Protected orders used"
      >
        <div
          className={`app-meter__fill${tone === "ok" ? "" : ` app-meter__fill--${tone}`}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  small,
  accent,
}: {
  label: string;
  value: string;
  small?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={`app-bill-stat${accent ? " app-bill-stat--accent" : ""}`}>
      <span className="app-bill-stat__label">{label}</span>
      <span
        className={`app-bill-stat__value${small ? " app-bill-stat__value--sm" : ""}`}
      >
        {value}
      </span>
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
          <div className="app-bill-hero">
            <div className="app-bill-hero__main">
              <span className="app-bill-hero__name">{plan.name}</span>
              <span className="app-bill-hero__price">
                {plan.interval === "—"
                  ? plan.price
                  : `${plan.price} · ${plan.interval}`}
              </span>
            </div>
            <div className="app-bill-hero__side">
              <s-badge tone={hasActiveBilling ? "success" : "neutral"}>
                {hasActiveBilling ? "Active" : "Free plan"}
              </s-badge>
              <AppButton
                variant="secondary"
                onClick={() => setSearchParams({ plans: "1" })}
              >
                Change plan
              </AppButton>
            </div>
          </div>
        </Card>
      )}

      <Card heading="Usage this period">
        <div className="app-bill-stats">
          <Stat label="Protected orders" value={String(protectedOrders)} accent />
          {isUsage && (
            <Stat
              label="Kourify usage fee"
              value={`${money(USAGE_FEE_CENTS)} per order`}
              small
            />
          )}
          <Stat
            label="Usage charges"
            value={money(isUsage ? billedUsageCents : 0)}
            accent
          />
          {isBasic && quota.limit !== null && (
            <Stat
              label="Remaining allowance"
              value={`${quota.remaining} of ${quota.limit}`}
            />
          )}
        </div>

        {isBasic && quota.limit !== null && (
          <AllowanceMeter used={quota.used} limit={quota.limit} />
        )}

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
