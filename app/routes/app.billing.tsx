import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
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

export default function Billing() {
  const {
    activePlan,
    hasActiveBilling,
    quota,
    protectedOrders,
    billedUsageCents,
  } = useLoaderData<typeof loader>();

  const plan = PLAN_SUMMARY[activePlan];
  const isUsage = activePlan === "usage";
  const isBasic = activePlan === "basic";

  return (
    <s-page>
      <PageHeader
        title="Billing"
        subtitle="Manage your Kourify subscription through Shopify."
        actions={
          <AppButton href="/app" variant="secondary">
            Back
          </AppButton>
        }
      />

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
      </Card>

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

        <s-banner tone="info">
          {`A Kourify usage fee is ${money(USAGE_FEE_CENTS)} billed to you for each completed protected order on the Usage plan. It is not the protection price your customers pay, not coverage, and not a claim settlement — those are configured separately in Settings.`}
        </s-banner>

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

      <Card heading="Plans">
        <s-paragraph>
          Your plans and pricing are managed through Shopify. Changing plan
          takes you to Shopify to approve the charge.
        </s-paragraph>
        <ul className="app-guide__list">
          <li>
            <strong>Basic</strong> — free, up to {BASIC_PROTECTED_ORDER_LIMIT}{" "}
            protected orders.
          </li>
          <li>
            <strong>Usage</strong> — $10.00 every 30 days, plus a{" "}
            {money(USAGE_FEE_CENTS)} Kourify usage fee per protected order.
          </li>
          <li>
            <strong>Unlimited</strong> — $20.00 every 30 days, no usage fee.
          </li>
        </ul>
        <div className="app-actions">
          {activePlan !== "usage" && (
            <AppButton href="/app/billing/start?plan=usage" variant="secondary">
              Switch to Usage
            </AppButton>
          )}
          {activePlan !== "unlimited" && (
            <AppButton
              href="/app/billing/start?plan=unlimited"
              variant="secondary"
            >
              Switch to Unlimited
            </AppButton>
          )}
          {hasActiveBilling && (
            <AppButton href="/app/billing/start?plan=basic" variant="secondary">
              Downgrade to Basic
            </AppButton>
          )}
        </div>
      </Card>

      <Card heading="Billing information">
        <s-paragraph>
          Shopify handles subscription billing and charges your store through
          Shopify. Kourify never sees or stores your payment details.
        </s-paragraph>
      </Card>
    </s-page>
  );
}
