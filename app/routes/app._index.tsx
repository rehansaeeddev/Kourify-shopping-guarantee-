import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { DEFAULT_CLAIM_WINDOWS } from "../lib/claim-window";
import { useFetcherToast } from "../hooks/useFetcherToast";
import { Card, StatTile } from "../components/Card";
import { DashboardHeader } from "../components/DashboardHeader";
import { GettingStarted } from "../components/GettingStarted";
import { StatusBadge } from "../components/StatusBadge";
import { issueTypeLabel } from "../lib/claim-issue-type";
import { AppButton } from "../components/AppButton";
import { InfoTip } from "../components/InfoTip";
import { TrustBadgePreview } from "../components/TrustBadgePreview";
import { getProtectionTelemetry } from "../lib/protection-telemetry.server";
import { getProtectionAnalytics } from "../lib/protection-orders.server";
import { getBillingState } from "../lib/billing-state.server";
import { getProtectionQuota } from "../lib/plan-limits.server";

const BADGE_STYLES = ["classic", "minimal", "bold"] as const;

const TAB_POSITIONS = [
  { value: "right", label: "Right edge (vertical)" },
  { value: "left", label: "Left edge (vertical)" },
  { value: "bottom", label: "Bottom corner" },
  { value: "top", label: "Top corner" },
] as const;

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
    recentClaims,
    telemetry,
    analytics,
    { hasActiveBilling, activePlan },
  ] = await Promise.all([
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
    getProtectionAnalytics(session.shop),
    getBillingState(billing),
  ]);

  const quota = await getProtectionQuota(session.shop, activePlan);

  const shopName = session.shop.replace(/\.myshopify\.com$/, "");
  const greeting = `${greetingForHour(new Date().getHours())}, ${shopName}`;

  return {
    greeting,
    settings,
    openClaims,
    totalClaims,
    recentClaims,
    telemetry,
    analytics,
    hasActiveBilling,
    quota,
  };
};

/** Badge + guarantee-tab settings are edited inline on this page. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const badgesEnabled = formData.get("badgesEnabled") === "true";
  const requestedBadgeStyle = String(formData.get("badgeStyle") ?? "classic");
  const badgeStyle = BADGE_STYLES.includes(
    requestedBadgeStyle as (typeof BADGE_STYLES)[number],
  )
    ? requestedBadgeStyle
    : "classic";
  const showOnProduct = formData.get("showOnProduct") === "true";
  const showOnCart = formData.get("showOnCart") === "true";
  const requestedTabPosition = String(
    formData.get("guaranteeTabPosition") ?? "right",
  );
  const guaranteeTabPosition = TAB_POSITIONS.some(
    (p) => p.value === requestedTabPosition,
  )
    ? requestedTabPosition
    : "right";

  const settings = await db.merchantSettings.update({
    where: { shop: session.shop },
    data: {
      badgesEnabled,
      badgeStyle,
      showOnProduct,
      showOnCart,
      guaranteeTabPosition,
    },
  });

  return { settings };
};

export default function Index() {
  const {
    greeting,
    settings,
    openClaims,
    totalClaims,
    recentClaims,
    telemetry,
    analytics,
    quota,
  } = useLoaderData<typeof loader>();

  const badgeFetcher = useFetcher<typeof action>();
  const current = badgeFetcher.data?.settings ?? settings;

  useFetcherToast(badgeFetcher, () => "Badge settings saved.");

  const saveBadges = (overrides: Partial<typeof current> = {}) => {
    const next = { ...current, ...overrides };
    badgeFetcher.submit(
      {
        badgesEnabled: String(next.badgesEnabled),
        badgeStyle: next.badgeStyle,
        showOnProduct: String(next.showOnProduct),
        showOnCart: String(next.showOnCart),
        guaranteeTabPosition: next.guaranteeTabPosition,
      },
      { method: "POST" },
    );
  };

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
    <s-page>
      <DashboardHeader
        greeting={greeting}
        subtitle="Build shopper confidence from cart to delivery."
        actions={
          <>
            <InfoTip id="tip-why-this-matters" label="Why this matters">
              Trust badges and buyer guarantees increase checkout confidence and
              reduce chargebacks. We roll out each capability only once
              it&apos;s backed by a real, honest guarantee — package protection
              today is a self-funded policy, not underwritten insurance, and
              claims are reviewed manually rather than paid out automatically.
            </InfoTip>
            <AppButton href="/app/guide" variant="secondary">
              Help
            </AppButton>
            <AppButton href="/app/order-sync" variant="secondary">
              Order sync
            </AppButton>
          </>
        }
      />

      <GettingStarted
        title="Get started with Kourify"
        help={{
          label: "New here? Open Help & getting started →",
          href: "/app/guide",
        }}
        steps={[
          {
            label: "Turn on trust badges",
            detail: current.badgesEnabled
              ? `On · ${current.badgeStyle} style`
              : "Show a trust badge on your product page and cart — set it up below.",
            done: current.badgesEnabled,
          },
          {
            label: "Package protection is live on your storefront",
            detail:
              'The "Protect your order" widget is on your product page and cart. Customize copy and price from the theme editor blocks.',
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

      <div className="app-card-row">
        <StatTile
          icon="shield-check-mark"
          label="Trust badges"
          tone={current.badgesEnabled ? "success" : "default"}
          value={current.badgesEnabled ? "On" : "Off"}
          sub={
            current.badgesEnabled
              ? `${current.badgeStyle.charAt(0).toUpperCase()}${current.badgeStyle.slice(1)} style`
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
      </div>

      {/* Performance. These moved off Settings, which is configuration only.
          "Protection sales" is the same figure the old "Protection revenue"
          tile showed, so that duplicate is gone rather than shown twice. */}
      <div className="app-card-row" style={{ marginTop: "1.25rem" }}>
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
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <Card>
          <div className="app-feature__head">
            <h3 className="app-card__heading">Safe Shopping Trustmarks</h3>
            <s-text color="subdued">
              Build confidence with a trust badge across your store.
            </s-text>
          </div>

          <s-stack
            direction="inline"
            gap="large-100"
            alignItems="start"
            justifyContent="space-between"
          >
            <s-stack direction="block" gap="base">
              <div className="app-setting app-setting--switch">
                <s-switch
                  label="Show trust badge on storefront"
                  checked={current.badgesEnabled}
                  onChange={(e) =>
                    saveBadges({ badgesEnabled: e.currentTarget.checked })
                  }
                />
                <span className="app-setting__desc">
                  Display on your store&apos;s theme
                </span>
              </div>
              <div className="app-setting app-setting--check">
                <s-checkbox
                  label="Show on product pages"
                  checked={current.showOnProduct}
                  disabled={!current.badgesEnabled}
                  onChange={(e) =>
                    saveBadges({ showOnProduct: e.currentTarget.checked })
                  }
                />
                <span className="app-setting__desc">
                  Display badge on product pages
                </span>
              </div>
              <div className="app-setting app-setting--check">
                <s-checkbox
                  label="Show in cart"
                  checked={current.showOnCart}
                  disabled={!current.badgesEnabled}
                  onChange={(e) =>
                    saveBadges({ showOnCart: e.currentTarget.checked })
                  }
                />
                <span className="app-setting__desc">
                  Display badge in cart and drawer
                </span>
              </div>
            </s-stack>

            <div className="app-badge-settings">
              <s-select
                label="Badge style"
                value={current.badgeStyle}
                disabled={!current.badgesEnabled}
                onChange={(e) =>
                  saveBadges({ badgeStyle: e.currentTarget.value })
                }
              >
                {BADGE_STYLES.map((style) => (
                  <s-option key={style} value={style}>
                    {style.charAt(0).toUpperCase() + style.slice(1)}
                  </s-option>
                ))}
              </s-select>

              <div className="app-badge-preview">
                <s-text color="subdued">Preview — what shoppers see</s-text>
                <div className="app-badge-preview__frame">
                  <TrustBadgePreview badgeStyle={current.badgeStyle} />
                </div>
                <span className="app-setting__desc">
                  This is how your trust badge will appear on your store.
                </span>
              </div>
            </div>
          </s-stack>
        </Card>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <Card heading="Guarantee tab">
          <s-stack
            direction="inline"
            gap="large-100"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-paragraph>
              The floating Kourify Guarantee tab shoppers use to learn about
              protection and file claims.
            </s-paragraph>
            <div style={{ inlineSize: "200px", flex: "0 0 auto" }}>
              <s-select
                label="Tab position"
                value={current.guaranteeTabPosition}
                onChange={(e) =>
                  saveBadges({ guaranteeTabPosition: e.currentTarget.value })
                }
              >
                {TAB_POSITIONS.map((pos) => (
                  <s-option key={pos.value} value={pos.value}>
                    {pos.label}
                  </s-option>
                ))}
              </s-select>
            </div>
          </s-stack>
        </Card>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <Card heading="Recent claims">
          {recentClaims.length === 0 ? (
            <s-banner tone="info">
              No claims yet — they'll show up here once a customer files one
              from your storefront.
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
              <div className="app-actions">
                <AppButton href="/app/claims" variant="secondary">
                  View all claims
                </AppButton>
              </div>
            </>
          )}
        </Card>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
