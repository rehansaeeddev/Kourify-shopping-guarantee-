import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { DEFAULT_CLAIM_WINDOWS } from "../lib/claim-window";
import { Card, StatTile } from "../components/Card";
import { GettingStarted } from "../components/GettingStarted";
import { StatusBadge } from "../components/StatusBadge";
import { issueTypeLabel } from "../lib/claim-issue-type";
import { EmptyState } from "../components/EmptyState";
import { getProtectionTelemetry } from "../lib/protection-telemetry.server";
import { getProtectionAnalytics } from "../lib/protection-orders.server";
import { getBillingState } from "../lib/billing-state.server";
import { getProtectionQuota } from "../lib/plan-limits.server";

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
    create: {
      shop: session.shop,
      claimWindows: JSON.stringify(DEFAULT_CLAIM_WINDOWS),
    },
  });

  const [
    openClaims,
    totalClaims,
    totalOrders,
    recentClaims,
    telemetry,
    analytics,
    { hasActiveBilling, activePlan },
  ] = await Promise.all([
    db.protectionClaim.count({
      where: { shop: session.shop, status: { in: ["submitted", "reviewing"] } },
    }),
    db.protectionClaim.count({ where: { shop: session.shop } }),
    db.order.count({ where: { shop: session.shop } }),
    db.protectionClaim.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    getProtectionTelemetry(session.shop, admin),
    getProtectionAnalytics(session.shop),
    getBillingState(billing),
  ]);

  const quota = await getProtectionQuota(session.shop, activePlan);

  const shopName = session.shop.replace(/\.myshopify\.com$/, "");
  const greeting = `${greetingForHour(new Date().getHours())}, ${shopName}`;

  return {
    greeting,
    shop: session.shop,
    settings,
    openClaims,
    totalClaims,
    totalOrders,
    recentClaims,
    telemetry,
    analytics,
    hasActiveBilling,
    quota,
  };
};

// The dashboard Overview metrics are hidden for now — flip this to true to
// bring the card back. The data is still loaded and the card stays fully wired.
const SHOW_DASHBOARD_METRICS = false;

export default function Index() {
  const {
    greeting,
    shop,
    settings,
    openClaims,
    totalClaims,
    totalOrders,
    recentClaims,
    telemetry,
    analytics,
    quota,
  } = useLoaderData<typeof loader>();

  const feeSummary =
    settings.protectionPayer === "merchant"
      ? "Free for customers"
      : settings.protectionFeeType === "percentage"
        ? `${(settings.protectionPercentBasisPoints / 100).toFixed(1)}% of order`
        : `$${(settings.protectionFlatFeeCents / 100).toFixed(2)} per order`;

  // Allowance spent outranks the stored on/off state — protection really is
  // off on the storefront, so the tile must not still read "Live".
  const protectionStatus = quota.exhausted
    ? {
        tone: "warning" as const,
        value: "Limit reached",
        sub: `${quota.used} of ${quota.limit} orders`,
      }
    : !settings.protectionEnabled
      ? { tone: "default" as const, value: "Off", sub: null }
      : { tone: "success" as const, value: "Live", sub: feeSummary };

  return (
    <s-page heading={greeting}>
      {/* One block stack owns the vertical rhythm so every card gets clear,
          even space above and below it. */}
      <s-stack direction="block" gap="large">
        {/* The one deliberately custom-styled banner (see theme.css), added on
            request. Its buttons stay real s-buttons so navigation still works
            inside the embedded admin. */}
        <div className="app-dashboard-header">
          <div>
            <h2 className="app-dashboard-header__title">Dashboard</h2>
            <p className="app-dashboard-header__subtitle">
              Order protection at a glance — offers, claims, and coverage across
              your store.
            </p>
          </div>
          <div className="app-dashboard-header__actions">
            <s-button href="/app/guide" variant="secondary">
              Help
            </s-button>
            <s-button href="/app/order-sync" variant="primary">
              Order sync
            </s-button>
          </div>
        </div>

        <GettingStarted
        title="Get started with Kourify"
        help={{
          label: "New here? Open Help & getting started →",
          href: "/app/guide",
        }}
        steps={[
          {
            label: "Turn on trust badges",
            detail: settings.badgesEnabled
              ? `On · ${settings.badgeStyle} style`
              : "Show a trust badge on your product page and cart — turn it on in Settings.",
            done: settings.badgesEnabled,
            action: settings.badgesEnabled
              ? undefined
              : { label: "Set up trust badges", href: "/app/settings" },
          },
          {
            label: "Package protection is live on your storefront",
            detail:
              protectionStatus.value === "Live"
                ? 'The "Protect your order" widget is on your product page and cart. Customize copy and price from the theme editor blocks.'
                : "Turn on protection at checkout in Settings to make it live for shoppers.",
            done: protectionStatus.value === "Live",
            action:
              protectionStatus.value === "Live"
                ? undefined
                : { label: "Open settings", href: "/app/settings" },
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

      {/* Dashboard: a dense stat row, then a protection-mix and status pair,
          then a help panel — every card is filled, no dead space. The setup
          guide and config cards below are unchanged. */}
      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))"
        gap="base"
      >
        {(
          [
            {
              icon: "order",
              tone: "neutral",
              label: "Orders",
              value: String(totalOrders),
            },
            {
              icon: "shield-check-mark",
              tone: "success",
              label: "Protected",
              value: String(analytics.protectedOrders),
            },
            {
              icon: "clock",
              tone: openClaims > 0 ? "warning" : "neutral",
              label: "Open claims",
              value: String(openClaims),
            },
            {
              icon: "cash-dollar",
              tone: "success",
              label: "Protection sales",
              value: `$${(analytics.protectionRevenueCents / 100).toFixed(2)}`,
            },
          ] as const
        ).map((stat) => (
          <s-box
            key={stat.label}
            padding="base"
            background="base"
            borderWidth="base"
            borderColor="base"
            borderRadius="base"
          >
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-icon type={stat.icon as never} tone={stat.tone} size="base" />
              <s-stack direction="block" gap="small-500">
                <s-heading>{stat.value}</s-heading>
                <s-text color="subdued">{stat.label}</s-text>
              </s-stack>
            </s-stack>
          </s-box>
        ))}
      </s-grid>

      <s-grid
        gridTemplateColumns="@container (inline-size <= 720px) 1fr, 1fr 1fr"
        gap="base"
        alignItems="stretch"
      >
        <Card heading="Protection mix">
          <s-stack direction="block" gap="base">
            <s-stack
              direction="inline"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-text type="strong">
                {`${
                  totalOrders > 0
                    ? Math.round(
                        (analytics.protectedOrders / totalOrders) * 100,
                      )
                    : 0
                }% protected`}
              </s-text>
              <s-badge
                tone={analytics.protectedOrders > 0 ? "success" : "neutral"}
              >
                {`${analytics.protectedOrders} of ${totalOrders}`}
              </s-badge>
            </s-stack>
            {totalOrders > 0 ? (
              <s-grid
                gridTemplateColumns={`${analytics.protectedOrders}fr ${Math.max(
                  totalOrders - analytics.protectedOrders,
                  0,
                )}fr`}
                gap="small-500"
              >
                <s-box
                  background="strong"
                  borderRadius="base"
                  minBlockSize="10px"
                />
                <s-box
                  background="subdued"
                  borderRadius="base"
                  minBlockSize="10px"
                />
              </s-grid>
            ) : (
              <s-box
                background="subdued"
                borderRadius="base"
                minBlockSize="10px"
              />
            )}
            <s-stack direction="inline" gap="base">
              <s-text color="subdued">
                {`Protected ${analytics.protectedOrders}`}
              </s-text>
              <s-text color="subdued">
                {`Unprotected ${Math.max(
                  totalOrders - analytics.protectedOrders,
                  0,
                )}`}
              </s-text>
            </s-stack>
          </s-stack>
        </Card>

        <Card heading="Protection status">
          <s-stack direction="block" gap="small-200">
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-text color="subdued">Store</s-text>
              <s-text>{shop}</s-text>
            </s-stack>
            <s-divider direction="inline" />
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-text color="subdued">Checkout protection</s-text>
              <s-badge
                tone={
                  protectionStatus.tone === "default"
                    ? "neutral"
                    : protectionStatus.tone
                }
              >
                {protectionStatus.value}
              </s-badge>
            </s-stack>
            <s-divider direction="inline" />
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-text color="subdued">Coverage</s-text>
              <s-text>{feeSummary}</s-text>
            </s-stack>
          </s-stack>
        </Card>
      </s-grid>

      <Card heading="Help & resources">
        <s-grid
          gridTemplateColumns="@container (inline-size <= 720px) 1fr, 1fr 1fr"
          gap="base"
        >
          <s-clickable
            href="/app/guide"
            padding="base"
            background="subdued"
            borderRadius="base"
          >
            <s-stack direction="block" gap="small-400">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-icon type="info" tone="neutral" size="base" />
                <s-text type="strong">How it works</s-text>
              </s-stack>
              <s-text color="subdued">
                Offers, claims, and coverage explained.
              </s-text>
            </s-stack>
          </s-clickable>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="small-400">
              <s-link href="mailto:support@kourify.com">Contact support</s-link>
              <s-text color="subdued">support@kourify.com</s-text>
            </s-stack>
          </s-box>
        </s-grid>
      </Card>

      {/* One Overview card holds every KPI in a packed grid, rather than two
          half-empty Status/Performance cards spread thin across the width.
          "Protection sales" is the same figure the old "Protection revenue"
          tile showed, so that duplicate is gone rather than shown twice.
          Hidden for now behind SHOW_DASHBOARD_METRICS. */}
      {SHOW_DASHBOARD_METRICS && (
        <Card heading="Overview">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
          gap="large"
        >
          <StatTile
            icon="shield-check-mark"
            label="Trust badges"
            tone={settings.badgesEnabled ? "success" : "default"}
            value={settings.badgesEnabled ? "On" : "Off"}
            sub={
              settings.badgesEnabled
                ? `${settings.badgeStyle.charAt(0).toUpperCase()}${settings.badgeStyle.slice(1)} style`
                : "Not shown to customers"
            }
          />
          <StatTile
            icon="check-circle"
            label="Protection status"
            tone={protectionStatus.tone}
            value={protectionStatus.value}
            sub={protectionStatus.sub}
            href="/app/settings"
          />
          <StatTile
            icon="chart-line"
            label="Claim incident rate"
            tone={
              telemetry.incidentRate !== null && telemetry.incidentRate > 3
                ? "critical"
                : "default"
            }
            value={
              telemetry.incidentRate !== null
                ? `${telemetry.incidentRate.toFixed(1)}%`
                : "No data yet"
            }
            sub="Of fulfilled orders"
            href="/app/claims"
          />
          <StatTile
            icon="shield-check-mark"
            label="Protected orders"
            tone={analytics.protectedOrders > 0 ? "success" : "default"}
            value={String(analytics.protectedOrders)}
            sub="Orders with protection"
          />
          <StatTile
            icon="chart-line"
            label="Selection rate"
            value={`${analytics.conversionRate.toFixed(1)}%`}
            sub="Of eligible orders"
          />
          <StatTile
            icon="cash-dollar"
            label="Protection sales"
            tone={analytics.protectionRevenueCents > 0 ? "success" : "default"}
            value={`$${(analytics.protectionRevenueCents / 100).toFixed(2)}`}
            sub="All time"
          />
          <StatTile
            icon="receipt-dollar"
            label="Usage fees"
            value={`$${(analytics.usageFeesCents / 100).toFixed(2)}`}
            sub="Billed this period"
          />
        </s-grid>
        </Card>
      )}

      <Card heading="Recent claims">
        {recentClaims.length === 0 ? (
          <EmptyState
            icon="clipboard-checklist"
            heading="No claims yet"
            description="They'll show up here once a customer files one from your storefront."
          />
        ) : (
          <>
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Order</s-table-header>
                <s-table-header listSlot="secondary">Customer</s-table-header>
                <s-table-header listSlot="labeled">Issue</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {recentClaims.map((claim) => (
                  <s-table-row key={claim.id}>
                    <s-table-cell>{claim.orderNumber}</s-table-cell>
                    <s-table-cell>{claim.fullName}</s-table-cell>
                    <s-table-cell>
                      {issueTypeLabel(claim.issueType)}
                    </s-table-cell>
                    <s-table-cell>
                      <StatusBadge status={claim.status} />
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-button href="/app/claims" variant="secondary">
              View all claims
            </s-button>
          </>
        )}
      </Card>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
