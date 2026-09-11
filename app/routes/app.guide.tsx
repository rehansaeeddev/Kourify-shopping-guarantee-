import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Card } from "../components/Card";
import { AppButton } from "../components/AppButton";
import { getBillingState } from "../lib/billing-state.server";
import { getProtectionQuota } from "../lib/plan-limits.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  // Help is state-aware, so it reads the same signals the rest of the app
  // does rather than describing a generic setup that may not apply.
  const settings = await db.merchantSettings.findUnique({
    where: { shop: session.shop },
  });
  const { hasActiveBilling, activePlan } = await getBillingState(billing);
  const quota = await getProtectionQuota(session.shop, activePlan);
  const openClaims = await db.protectionClaim.count({
    where: { shop: session.shop, status: { in: ["submitted", "reviewing"] } },
  });

  return {
    protectionEnabled: Boolean(settings?.protectionEnabled),
    badgesEnabled: Boolean(settings?.badgesEnabled),
    hasActiveBilling,
    quota,
    openClaims,
  };
};

const FLOW = [
  "Customer selects protection",
  "Eligible item becomes protected",
  "Something goes wrong",
  "Customer submits a claim with evidence",
  "You review the claim",
  "You approve or deny it",
  "Customer is notified",
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
  const {
    protectionEnabled,
    badgesEnabled,
    hasActiveBilling,
    quota,
    openClaims,
  } = useLoaderData<typeof loader>();

  // Three real states, derived from what actually stops protection running.
  const state = quota.exhausted
    ? "limit"
    : protectionEnabled
      ? "active"
      : "setup";

  return (
    <s-page heading="Help &amp; getting started">
      <s-stack direction="block" gap="large">
        {/* Branded header, matching the dashboard's (see theme.css). Back stays
            a real s-button so embedded navigation works. */}
        <div className="app-dashboard-header">
          <div>
            <h2 className="app-dashboard-header__title">
              How Shopping Guarantee works
            </h2>
            <p className="app-dashboard-header__subtitle">
              Offer optional order protection, let customers file claims when
              something goes wrong, and decide each one yourself.
            </p>
          </div>
          <div className="app-dashboard-header__actions">
            <s-button href="/app" variant="secondary">
              Back to home
            </s-button>
          </div>
        </div>

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

        {state === "setup" && (
          <Card heading="Finish setup">
            <s-paragraph>
              Three things to do before protection goes live.
            </s-paragraph>
            <s-stack direction="block" gap="large-100">
              <s-stack direction="block" gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-badge>1</s-badge>
                  <s-text type="strong">Configure protection</s-text>
                </s-stack>
                <s-paragraph color="subdued">
                  Choose who pays, set pricing, and define what&apos;s eligible.
                </s-paragraph>
                <s-stack direction="inline">
                  <s-button href="/app/settings" variant="secondary">
                    Open settings
                  </s-button>
                </s-stack>
              </s-stack>
              <s-stack direction="block" gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-badge>2</s-badge>
                  <s-text type="strong">Add storefront blocks</s-text>
                </s-stack>
                <s-paragraph color="subdued">
                  Add the protection widget and trust badge in your Shopify
                  theme editor.
                </s-paragraph>
                <s-stack direction="inline">
                  <s-button href="/app" variant="secondary">
                    Badge settings
                  </s-button>
                </s-stack>
              </s-stack>
              <s-stack direction="block" gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-badge>3</s-badge>
                  <s-text type="strong">Turn on protection</s-text>
                </s-stack>
                <s-paragraph color="subdued">
                  Switch on protection at checkout from Settings → General.
                </s-paragraph>
                <s-stack direction="inline">
                  <s-button href="/app/settings" variant="secondary">
                    Turn it on
                  </s-button>
                </s-stack>
              </s-stack>
            </s-stack>
          </Card>
        )}

        {state === "active" && (
          <Card heading="Your protection is active">
            <s-paragraph>
              Shopping Guarantee is currently available for eligible orders.
              {quota.limit !== null
                ? ` You've protected ${quota.used} of ${quota.limit} orders on your plan.`
                : ""}
            </s-paragraph>
            <s-stack direction="inline" gap="small-200">
              <s-button href="/app/settings" variant="secondary">
                Manage settings
              </s-button>
              <s-button href="/app/claims" variant="secondary">
                {openClaims > 0 ? `View claims (${openClaims})` : "View claims"}
              </s-button>
              <s-button href="/app/orders" variant="secondary">
                View orders
              </s-button>
            </s-stack>
          </Card>
        )}

        <Card heading="How protection works">
          <s-ordered-list>
            {FLOW.map((step) => (
              <s-list-item key={step}>{step}</s-list-item>
            ))}
          </s-ordered-list>
          <s-banner tone="info">
            Shopping Guarantee is currently a self-funded, manually reviewed
            guarantee. It is not underwritten insurance, and claims are not
            automatically approved.
          </s-banner>
        </Card>

        <Card heading="Common tasks">
          <s-stack direction="block" gap="small-200">
            <s-link href="/app/settings">
              Change who pays, pricing or eligibility
            </s-link>
            <s-link href="/app/claims">Review and decide open claims</s-link>
            <s-link href="/app/orders">
              See which orders are protected, or offer protection after purchase
            </s-link>
            <s-link href="/app/translations">
              Translate the storefront claim form
            </s-link>
            <s-link href="/app/billing">
              {hasActiveBilling ? "Change your plan" : "Choose a plan"}
            </s-link>
          </s-stack>
        </Card>

        <Card heading="Questions">
          {/* A rule between entries, so a run of question/answer pairs reads as
              separate items rather than one wall of text. */}
          <s-stack direction="block" gap="base">
            {FAQ.map(([question, answer], index) => (
              <s-stack key={question} direction="block" gap="small-300">
                {index > 0 && <s-divider />}
                <s-heading>{question}</s-heading>
                <s-paragraph color="subdued">{answer}</s-paragraph>
              </s-stack>
            ))}
          </s-stack>
        </Card>

        {!badgesEnabled && state !== "setup" && (
          <s-banner tone="info">
            Trust badges are switched off, so shoppers don&apos;t see them on
            your storefront.{" "}
            <s-link href="/app">Turn them on from Home.</s-link>
          </s-banner>
        )}
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
