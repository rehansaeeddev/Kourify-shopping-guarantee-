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

      {!hasActiveBilling ? (
        <ActivatePlan currentPlan={settings.plan} onChoose={startBilling} />
      ) : (
        <Card heading="Plan">
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="block" gap="small-200">
              <s-text>
                {settings.plan === "unlimited"
                  ? "Unlimited · $20/mo"
                  : "Usage · $10/mo + $0.60 per protected order"}
              </s-text>
              <s-text color="subdued">Your current Kourify plan</s-text>
            </s-stack>
            <AppButton
              variant="secondary"
              onClick={() =>
                startBilling(settings.plan === "unlimited" ? "usage" : "unlimited")
              }
            >
              {settings.plan === "unlimited"
                ? "Switch to Usage"
                : "Switch to Unlimited"}
            </AppButton>
          </s-stack>
        </Card>
      )}
    </s-page>
  );
}

function ActivatePlan({
  currentPlan,
  onChoose,
}: {
  currentPlan: string;
  onChoose: (plan: string) => void;
}) {
  const plans = [
    {
      id: "usage",
      name: "Usage",
      price: "$10/mo",
      detail: "+ $0.60 per protected order",
    },
    {
      id: "unlimited",
      name: "Unlimited",
      price: "$20/mo",
      detail: "Unlimited protected orders",
    },
  ];
  const willConfigure: Array<[string, string]> = [
    ["Who pays", "Charge customers at checkout, or cover it for every order."],
    ["Pricing", "A flat fee or a percentage of order value, with a floor and ceiling."],
    ["Claim reasons", "Choose which claim types customers can file."],
    ["Filing windows", "Set how long after shipping each claim can be filed."],
  ];

  return (
    <>
      <Card heading="Activate Shopping Guarantee">
        <s-paragraph>
          Choose a plan to turn on package protection and start reviewing claims.
          Change or cancel anytime.
        </s-paragraph>
        <div className="app-plan-grid">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={
                "app-plan" +
                (currentPlan === plan.id ? " app-plan--current" : "")
              }
            >
              <span className="app-plan__name">{plan.name}</span>
              <span className="app-plan__price">{plan.price}</span>
              <span className="app-plan__detail">{plan.detail}</span>
              <AppButton variant="primary" onClick={() => onChoose(plan.id)}>
                Choose {plan.name}
              </AppButton>
            </div>
          ))}
        </div>
      </Card>

      <Card heading="What you'll set up once active">
        <s-stack direction="block" gap="base">
          {willConfigure.map(([title, description]) => (
            <s-stack key={title} direction="block" gap="small-200">
              <s-text>{title}</s-text>
              <s-text color="subdued">{description}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </Card>
    </>
  );
}
