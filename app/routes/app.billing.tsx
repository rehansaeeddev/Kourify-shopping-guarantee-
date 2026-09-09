import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PageHeader } from "../components/PageHeader";
import { Card } from "../components/Card";
import { AppButton } from "../components/AppButton";
import { DEFAULT_CLAIM_WINDOWS } from "../lib/claim-window";
import { getBillingState } from "../lib/billing-state.server";

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

  const { hasActiveBilling, activePlan } = await getBillingState(billing);
  const currentSettings =
    activePlan && settings.plan !== activePlan
      ? await db.merchantSettings.update({
          where: { shop: session.shop },
          data: { plan: activePlan },
        })
      : settings;

  return { settings: currentSettings, hasActiveBilling };
};

const PLANS = [
  {
    id: "usage",
    name: "Usage",
    price: "$10",
    period: "/month",
    detail: "Plus $0.60 per protected order",
    features: [
      "$0.60 only on orders customers protect",
      "Trust badges on product pages and cart",
      "Customer-paid or merchant-paid protection",
      "Flat fee or percentage of order value",
      "Unlimited claim reviews and CSV export",
      "Best for stores getting started",
    ],
  },
  {
    id: "unlimited",
    name: "Unlimited",
    price: "$20",
    period: "/month",
    detail: "No per-order fees",
    features: [
      "Everything in Usage, no per-order fee",
      "Unlimited protected orders every month",
      "Predictable flat monthly cost",
      "Claim reasons and filing windows you control",
      "Multi-language storefront widgets",
      "Best value above ~17 protected orders",
    ],
  },
] as const;

const WILL_CONFIGURE: Array<[string, string]> = [
  ["Who pays", "Charge customers at checkout, or cover it for every order."],
  [
    "Pricing",
    "A flat fee or a percentage of order value, with a floor and ceiling.",
  ],
  ["Claim reasons", "Choose which claim types customers can file."],
  ["Filing windows", "Set how long after shipping each claim can be filed."],
];

export default function Billing() {
  const { settings, hasActiveBilling } = useLoaderData<typeof loader>();

  const startBilling = (plan: string) => {
    const url = new URL(window.location.href);
    url.pathname = "/app/billing/start";
    url.searchParams.set("plan", plan);
    window.location.assign(url.toString());
  };

  return (
    <s-page>
      <PageHeader
        title="Billing"
        subtitle="Manage your Kourify plan and billing."
        actions={
          <AppButton href="/app" variant="secondary">
            Back
          </AppButton>
        }
      />

      <div className="app-plan-grid">
        {PLANS.map((plan) => {
          const isCurrent = hasActiveBilling && settings.plan === plan.id;
          return (
            <div
              key={plan.id}
              className={"app-plan" + (isCurrent ? " app-plan--current" : "")}
            >
              <div className="app-plan__head">
                <span className="app-plan__name">{plan.name}</span>
                {isCurrent && <s-badge tone="success">Current plan</s-badge>}
              </div>

              <span className="app-plan__price">
                {plan.price}
                <span className="app-plan__period">{plan.period}</span>
              </span>
              <span className="app-plan__detail">{plan.detail}</span>

              <ul className="app-plan__features">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <div className="app-plan__action">
                <AppButton
                  variant={isCurrent ? "secondary" : "primary"}
                  disabled={isCurrent}
                  onClick={() => startBilling(plan.id)}
                >
                  {isCurrent
                    ? "Current plan"
                    : hasActiveBilling
                      ? `Switch to ${plan.name}`
                      : `Choose ${plan.name}`}
                </AppButton>
              </div>
            </div>
          );
        })}
      </div>

      {!hasActiveBilling && (
        <Card heading="What you'll set up once active">
          <s-stack direction="block" gap="base">
            {WILL_CONFIGURE.map(([title, description]) => (
              <s-stack key={title} direction="block" gap="small-200">
                <s-text>{title}</s-text>
                <s-text color="subdued">{description}</s-text>
              </s-stack>
            ))}
          </s-stack>
        </Card>
      )}
    </s-page>
  );
}
