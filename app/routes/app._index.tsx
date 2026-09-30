import { Card, MetricsCard, StatTile } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { GettingStarted } from "../components/GettingStarted";
import { PageError, PageSkeleton } from "../components/PageState";
import { StatusBadge } from "../components/StatusBadge";
import { issueTypeLabel } from "../lib/claim-issue-type";
import { useDashboard } from "../lib/queries";
import { PageBody } from "../components/PageBody";

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// The dashboard Overview metrics are hidden for now — flip this to true to
// bring the card back. The data is still loaded and the card stays fully wired.
const SHOW_DASHBOARD_METRICS = false;

export default function Index() {
  const { data, isPending, error, refetch } = useDashboard();

  if (isPending) return <PageSkeleton heading="Dashboard" />;
  if (error)
    return <PageError heading="Dashboard" error={error} onRetry={refetch} />;

  const {
    shop,
    settings,
    openClaims,
    totalClaims,
    recentClaims,
    telemetry,
    analytics,
    quota,
  } = data;

  // Greeting from the browser's clock, not the server's: "Good morning" has
  // to match the merchant's morning, and the backend runs wherever it runs.
  const greeting = `${greetingForHour(new Date().getHours())}, ${shop.replace(
    /\.myshopify\.com$/,
    "",
  )}`;

  // The one order count the admin shows anywhere, and analytics already
  // computes it against the same rows as protectedOrders.
  const totalOrders = analytics.totalOrders;

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

  // One definition for the share, printed in two places: the Protected
  // metric's sub-line and the Protection mix heading. They were drifting
  // apart as separate expressions waiting to happen.
  const protectedShare =
    totalOrders > 0
      ? Math.round((analytics.protectedOrders / totalOrders) * 100)
      : 0;

  return (
    <s-page inlineSize="large" heading={greeting}>
      {/*
        The page's own title bar, not a banner of ours. This used to be a
        custom green slab with its own heading and subtitle -- a second title
        competing with the one the admin already draws above it, styled
        against an admin appearance Shopify has since replaced. These slots put
        the same two actions where every other admin page keeps them.
      */}
      <s-button slot="primary-action" variant="primary" href="/app/order-sync">
        Order sync
      </s-button>
      <s-button slot="secondary-actions" href="/app/guide">
        Help
      </s-button>
      <PageBody>
        <GettingStarted
          title="Get started with Kourify"
          help={{
            label: "New here? Open Help & getting started →",
            href: "/app/guide",
          }}
          steps={[
            {
              label: "Turn on trust badges",
              icon: "shield-check-mark",
              minutes: 1,
              detail: settings.badgesEnabled
                ? `On · ${settings.badgeStyle} style`
                : "Show a trust badge on your product page and cart — turn it on in Settings.",
              done: settings.badgesEnabled,
              // A finished step keeps an action, it just changes verb. The row
              // is visible either way now, and one with nothing on its right
              // reads as a dead end rather than as something already handled.
              action: settings.badgesEnabled
                ? { label: "Customize", href: "/app/settings" }
                : { label: "Set up trust badges", href: "/app/settings" },
            },
            {
              label: "Package protection is live on your storefront",
              icon: "package",
              minutes: 3,
              detail:
                protectionStatus.value === "Live"
                  ? 'The "Protect your order" widget is on your product page and cart. Customize copy and price from the theme editor blocks.'
                  : "Turn on protection at checkout in Settings to make it live for shoppers.",
              done: protectionStatus.value === "Live",
              action:
                protectionStatus.value === "Live"
                  ? { label: "Manage", href: "/app/settings" }
                  : { label: "Open settings", href: "/app/settings" },
            },
            {
              label: "Review your first claim",
              icon: "clipboard-checklist",
              minutes: 2,
              detail:
                totalClaims > 0
                  ? `${totalClaims} claim${totalClaims === 1 ? "" : "s"} received${openClaims > 0 ? `, ${openClaims} open` : ""}.`
                  : "When a customer files a claim, it shows up here for you to review.",
              done: totalClaims > 0,
              action: { label: "View claims", href: "/app/claims" },
            },
          ]}
        />

        {/*
          One card, not four boxes.
          These are the page's headline figures, and four separate surfaces of
          equal weight made them compete with each other and with everything
          below. The App Home metrics composition puts them on a single
          surface with dividers between, which is also what stops them
          disappearing now the admin's page is white: one card reads as a card,
          four hairlined boxes read as a sheet of paper.
        */}
        <MetricsCard
          accessibilityLabel="Protection at a glance"
          /* Each sub-line restates something already true of the figure above
            it rather than introducing a number of its own -- a share, a
            count, or what the figure is drawn from. Nothing here is a
            comparison the dashboard cannot actually make: there is no
            previous period stored to compare against, and inventing a trend
            would be worse than a short card. */
          metrics={[
            {
              tone: "default",
              label: "Orders",
              value: String(totalOrders),
              sub: "Synced from Shopify",
            },
            {
              tone: "success",
              label: "Protected",
              value: String(analytics.protectedOrders),
              sub: `${protectedShare}% of orders`,
            },
            {
              tone: openClaims > 0 ? "warning" : "default",
              label: "Open claims",
              value: String(openClaims),
              sub: openClaims > 0 ? "Awaiting your review" : "Nothing waiting",
            },
            {
              tone: "success",
              label: "Protection sales",
              value: `$${(analytics.protectionRevenueCents / 100).toFixed(2)}`,
              sub:
                analytics.protectedOrders > 0
                  ? `Across ${analytics.protectedOrders} protected orders`
                  : "No protected orders yet",
            },
          ]}
        />

        <s-grid
          gridTemplateColumns="@container (inline-size <= 720px) 1fr, 1fr 1fr"
          gap="base"
          alignItems="stretch"
        >
          <Card heading="Protection mix" fill>
            <s-stack direction="block" gap="base">
              <s-stack
                direction="inline"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-text
                  type="strong"
                  tone={analytics.protectedOrders > 0 ? "success" : "neutral"}
                >
                  {`${protectedShare}% protected`}
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
              {/* The same label-left/value-right rows the status card beside
                this one uses, rather than the inline legend that was here.
                Two cards side by side reading differently made the shorter
                one look unfinished; matching the pattern also gives this one
                enough rows to stand at about the same height.

                Attach rate is deliberately absent: the backend computes
                conversionRate as protectedOrders / totalOrders * 100, which
                is the figure already at the top of this card. Showing it
                again under a second name would be one number pretending to
                be two. */}
              <s-stack direction="block" gap="small-200">
                <s-divider direction="inline" />
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <s-stack
                    direction="inline"
                    gap="small-500"
                    alignItems="center"
                  >
                    <s-icon
                      type="shield-check-mark"
                      tone="success"
                      size="small"
                    />
                    <s-text color="subdued">Protected</s-text>
                  </s-stack>
                  <s-text>{String(analytics.protectedOrders)}</s-text>
                </s-stack>
                <s-divider direction="inline" />
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <s-text color="subdued">Unprotected</s-text>
                  <s-text>
                    {String(
                      Math.max(totalOrders - analytics.protectedOrders, 0),
                    )}
                  </s-text>
                </s-stack>
              </s-stack>
            </s-stack>
          </Card>

          <Card heading="Protection status" fill>
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
              {/* The storefront half of protection, sat next to the checkout
                half. Its state was only rendered inside the Overview card,
                which is behind a flag, so the one thing a merchant turns on
                first had no status anywhere on this page. */}
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
              >
                <s-text color="subdued">Trust badges</s-text>
                <s-badge tone={settings.badgesEnabled ? "success" : "neutral"}>
                  {settings.badgesEnabled
                    ? `On · ${settings.badgeStyle} style`
                    : "Off"}
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
                tone={
                  analytics.protectionRevenueCents > 0 ? "success" : "default"
                }
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
      </PageBody>
    </s-page>
  );
}
