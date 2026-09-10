import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PageHeader } from "../components/PageHeader";
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
  const { protectionEnabled, badgesEnabled, hasActiveBilling, quota, openClaims } =
    useLoaderData<typeof loader>();

  // Three real states, derived from what actually stops protection running.
  const state = quota.exhausted
    ? "limit"
    : protectionEnabled
      ? "active"
      : "setup";

  return (
    <s-page>
      <PageHeader
        title="Help & getting started"
        subtitle="Set up Shopping Guarantee, understand how protection works, and manage claims and orders."
        actions={
          <AppButton href="/app" variant="secondary">
            Back to home
          </AppButton>
        }
      />

      {/* A banner, not a card: protection has stopped and there is one thing to
          do about it. The other two states are steady-state content and stay
          cards — a banner that is always on screen stops being read. */}
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
          <div className="app-help-steps">
            <div className="app-help-step">
              <span className="app-help-step__num">1</span>
              <div>
                <p className="app-help-step__title">Configure protection</p>
                <p className="app-help-step__body">
                  Choose who pays, set pricing, and define what&apos;s eligible.
                </p>
                <AppButton href="/app/settings" variant="secondary">
                  Open settings
                </AppButton>
              </div>
            </div>
            <div className="app-help-step">
              <span className="app-help-step__num">2</span>
              <div>
                <p className="app-help-step__title">Add storefront blocks</p>
                <p className="app-help-step__body">
                  Add the protection widget and trust badge in your Shopify
                  theme editor.
                </p>
                <AppButton href="/app" variant="secondary">
                  Badge settings
                </AppButton>
              </div>
            </div>
            <div className="app-help-step">
              <span className="app-help-step__num">3</span>
              <div>
                <p className="app-help-step__title">Turn on protection</p>
                <p className="app-help-step__body">
                  Switch on protection at checkout from Settings → General.
                </p>
                <AppButton href="/app/settings" variant="secondary">
                  Turn it on
                </AppButton>
              </div>
            </div>
          </div>
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
          <div className="app-actions">
            <AppButton href="/app/settings" variant="secondary">
              Manage settings
            </AppButton>
            <AppButton href="/app/claims" variant="secondary">
              {openClaims > 0 ? `View claims (${openClaims})` : "View claims"}
            </AppButton>
            <AppButton href="/app/orders" variant="secondary">
              View orders
            </AppButton>
          </div>
        </Card>
      )}

      <Card heading="How protection works">
        <ol className="app-steps">
          {FLOW.map((step) => (
            <li key={step}>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <s-banner tone="info">
          Shopping Guarantee is currently a self-funded, manually reviewed
          guarantee. It is not underwritten insurance, and claims are not
          automatically approved.
        </s-banner>
      </Card>

      <Card heading="Common tasks">
        <div className="app-help-links">
          <Link to="/app/settings">
            Change who pays, pricing or eligibility
          </Link>
          <Link to="/app/claims">Review and decide open claims</Link>
          <Link to="/app/orders">
            See which orders are protected, or offer protection after purchase
          </Link>
          <Link to="/app/translations">
            Translate the storefront claim form
          </Link>
          <Link to="/app/billing">
            {hasActiveBilling ? "Change your plan" : "Choose a plan"}
          </Link>
        </div>
      </Card>

      <Card heading="Questions">
        <div className="app-faq">
          {FAQ.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </Card>

      {!badgesEnabled && state !== "setup" && (
        <s-banner tone="info">
          Trust badges are switched off, so shoppers don&apos;t see them on your
          storefront. <Link to="/app">Turn them on from Home.</Link>
        </s-banner>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
