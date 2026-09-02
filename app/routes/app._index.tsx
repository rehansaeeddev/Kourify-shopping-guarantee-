import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { DEFAULT_CLAIM_WINDOWS } from "../lib/claim-window";
import { Card, StatTile } from "../components/Card";
import { DashboardHeader } from "../components/DashboardHeader";
import { GettingStarted } from "../components/GettingStarted";
import { StatusBadge } from "../components/StatusBadge";
import { issueTypeLabel } from "../lib/claim-issue-type";
import { AppButton } from "../components/AppButton";
import { EmptyState } from "../components/EmptyState";
import { getProtectionTelemetry } from "../lib/protection-telemetry.server";
import { getBillingState } from "../lib/billing-state.server";

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);

  const settings = await db.merchantSettings.upsert({
    where: { shop: session.shop },
    update: {},
    create: { shop: session.shop, claimWindows: JSON.stringify(DEFAULT_CLAIM_WINDOWS) },
  });

  const [openClaims, totalClaims, recentClaims, telemetry, { hasActiveBilling }] = await Promise.all([
    db.protectionClaim.count({
      where: { shop: session.shop, status: { in: ["submitted", "reviewing"] } },
    }),
    db.protectionClaim.count({ where: { shop: session.shop } }),
    db.protectionClaim.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    getProtectionTelemetry(session.shop, admin),
    getBillingState(billing),
  ]);

  const shopName = session.shop.replace(/\.myshopify\.com$/, "");
  const greeting = `${greetingForHour(new Date().getHours())}, ${shopName}`;

  return { greeting, settings, openClaims, totalClaims, recentClaims, telemetry, hasActiveBilling };
};

export default function Index() {
  const { greeting, settings, openClaims, totalClaims, recentClaims, telemetry, hasActiveBilling } =
    useLoaderData<typeof loader>();

  const feeSummary =
    settings.protectionPayer === "merchant"
      ? "Free for customers · you cover it"
      : settings.protectionFeeType === "percentage"
        ? `${(settings.protectionPercentBasisPoints / 100).toFixed(1)}% of order · customer pays`
        : `$${(settings.protectionFlatFeeCents / 100).toFixed(2)} flat · customer pays`;

  const protectionStatus = !hasActiveBilling
    ? { tone: "warning" as const, value: "Locked · choose a plan" }
    : !settings.protectionEnabled
      ? { tone: "default" as const, value: "Off" }
      : { tone: "success" as const, value: `Live · ${feeSummary}` };

  return (
    <s-page>
      <DashboardHeader
        greeting={greeting}
        subtitle="Build shopper confidence from cart to delivery."
        actions={
          <AppButton href="/app/order-sync" variant="secondary">
            Order sync
          </AppButton>
        }
      />

      <GettingStarted
        title="Get started with Kourify"
        steps={[
          {
            label: "Turn on trust badges",
            detail: settings.badgesEnabled
              ? `On · ${settings.badgeStyle} style`
              : "Show a trust badge on your product page and cart.",
            done: settings.badgesEnabled,
            action: { label: "Configure badges", href: "/app/badges" },
          },
          {
            label: "Package protection is live on your storefront",
            detail:
              "The \"Protect your order\" widget is on your product page and cart. Customize copy and price from the theme editor blocks.",
            done: true,
          },
          {
            label: "Review your first claim",
            detail:
              totalClaims > 0
                ? `${totalClaims} claim${totalClaims === 1 ? "" : "s"} received${openClaims > 0 ? `, ${openClaims} open` : ""}.`
                : "When a customer files a claim, it shows up here for you to review.",
            done: totalClaims > 0,
            action: { label: "View claims", href: "/app/claims" },
          },
        ]}
      />

      <Card heading="Setup status">
        <div className="app-card-row">
          <StatTile
            icon="shield-check-mark"
            label="Trust badges"
            tone={settings.badgesEnabled ? "success" : "default"}
            value={settings.badgesEnabled ? "On" : "Off"}
            href="/app/badges"
          />
          <StatTile
            icon="check-circle"
            label="Package protection"
            tone={protectionStatus.tone}
            value={protectionStatus.value}
            href="/app/protection"
          />
        </div>
      </Card>

      <div style={{ marginTop: "1.25rem" }}>
        <Card heading="Claims performance">
          {totalClaims === 0 ? (
            <EmptyState
              icon="clipboard-checklist"
              heading="No claims yet"
              description="Once customers start filing claims, you'll see open claims, resolution time, and incident rate here."
            />
          ) : (
            <div className="app-card-row">
              <StatTile
                icon="clock"
                label="Open claims"
                tone={openClaims > 0 ? "warning" : "default"}
                value={String(openClaims)}
                href="/app/claims"
              />
              <StatTile
                icon="clipboard-checklist"
                label="Total claims"
                value={String(totalClaims)}
                href="/app/claims"
              />
              <StatTile
                icon="clock"
                label="Avg. resolution time"
                value={
                  telemetry.avgResolutionHours !== null
                    ? `${telemetry.avgResolutionHours.toFixed(1)}h`
                    : "No claims resolved yet"
                }
                href="/app/claims"
              />
              <StatTile
                icon="chart-line"
                label="Claim incident rate"
                tone={telemetry.incidentRate !== null && telemetry.incidentRate > 3 ? "critical" : "default"}
                value={telemetry.incidentRate !== null ? `${telemetry.incidentRate.toFixed(1)}%` : "Not enough data yet"}
                href="/app/claims"
              />
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <Card heading="Recent claims">
          {recentClaims.length === 0 ? (
            <s-banner tone="info">
              No claims yet — they'll show up here once a customer files one from your storefront.
            </s-banner>
          ) : (
            <>
              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header>Order</s-table-header>
                  <s-table-header>Customer</s-table-header>
                  <s-table-header>Issue</s-table-header>
                  <s-table-header>Status</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {recentClaims.map((claim) => (
                    <s-table-row key={claim.id}>
                      <s-table-cell>{claim.orderNumber}</s-table-cell>
                      <s-table-cell>{claim.fullName}</s-table-cell>
                      <s-table-cell>{issueTypeLabel(claim.issueType)}</s-table-cell>
                      <s-table-cell>
                        <StatusBadge status={claim.status} />
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
              <div className="app-actions">
                <AppButton href="/app/claims" variant="secondary">
                  View all claims
                </AppButton>
              </div>
            </>
          )}
        </Card>
      </div>

      <s-section slot="aside" heading="Why this matters">
        <s-paragraph>
          Trust badges and buyer guarantees increase checkout confidence and
          reduce chargebacks. We roll out each capability only once it's
          backed by a real, honest guarantee — package protection today is a
          self-funded policy, not underwritten insurance, and claims are
          reviewed manually rather than paid out automatically.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
