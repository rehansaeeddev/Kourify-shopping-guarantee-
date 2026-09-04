import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { Form, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PageHeader } from "../components/PageHeader";
import { Card, StatTile } from "../components/Card";
import { AppButton } from "../components/AppButton";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { issueTypeLabel } from "../lib/claim-issue-type";
import { EVIDENCE_REQUIRED_TYPES } from "../lib/claim-window";
import { notifyClaimStatusChanged } from "../lib/notify.server";
import { isRateLimited } from "../lib/rate-limit.server";
import { WorkspaceTabs } from "../components/WorkspaceTabs";

const STATUSES = ["submitted", "reviewing", "resolved", "denied"] as const;
const TERMINAL_STATUSES = ["resolved", "denied"];

const TABS = [
  { value: "all", label: "All" },
  { value: "requires_evidence", label: "Requires evidence" },
  { value: "high_risk", label: "High risk" },
  { value: "resolved_today", label: "Resolved today" },
] as const;

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const PAGE_SIZE = 25;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "all";
  // Cap the search term's length; it's only ever used in parameterized
  // `contains` filters (never string-interpolated), so it can't inject.
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));

  const where: Record<string, unknown> = { shop: session.shop };
  if (tab === "requires_evidence") {
    where.issueType = { in: EVIDENCE_REQUIRED_TYPES };
  } else if (tab === "high_risk") {
    where.orderRiskLevel = { not: null, notIn: ["LOW"] };
  } else if (tab === "resolved_today") {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    where.status = { in: TERMINAL_STATUSES };
    where.resolvedAt = { gte: startOfToday };
  }
  if (q) {
    where.OR = [
      { orderNumber: { contains: q } },
      { shopifyOrderName: { contains: q } },
      { email: { contains: q } },
      { fullName: { contains: q } },
    ];
  }

  const [
    filteredCount,
    claims,
    emailCounts,
    totalClaims,
    openClaims,
    resolvedClaims,
  ] = await Promise.all([
    db.protectionClaim.count({ where }),
    db.protectionClaim.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    // Per-email totals via groupBy instead of loading every claim row into
    // memory just to tally them (which would OOM a high-volume shop).
    db.protectionClaim.groupBy({
      by: ["email"],
      where: { shop: session.shop },
      _count: { _all: true },
    }),
    db.protectionClaim.count({ where: { shop: session.shop } }),
    db.protectionClaim.count({
      where: {
        shop: session.shop,
        status: { in: ["submitted", "reviewing"] },
      },
    }),
    db.protectionClaim.count({
      where: { shop: session.shop, status: "resolved" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  return {
    claims,
    openClaims,
    resolvedClaims,
    totalClaims,
    filteredCount,
    tab,
    q,
    page,
    totalPages,
    emailClaimNumbers: Object.fromEntries(
      emailCounts.map((group) => [group.email, group._count._all]),
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Each status change can email the customer, so cap how fast one shop can
  // fire updates to prevent a runaway loop or abusive client from flooding.
  if (await isRateLimited(`claim-update:${session.shop}`, 120, 60 * 1000)) {
    return { ok: false, error: "Too many updates. Please slow down." };
  }

  const formData = await request.formData();
  const claimId = String(formData.get("claimId"));
  const status = String(formData.get("status"));
  // Only accept known statuses — this value is persisted and emailed to the
  // customer, so never trust an arbitrary form value.
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return { ok: false, error: "Invalid status" };
  }

  const existing = await db.protectionClaim.findFirst({
    where: { id: claimId, shop: session.shop },
  });

  await db.protectionClaim.updateMany({
    where: { id: claimId, shop: session.shop },
    data: {
      status,
      resolvedAt:
        TERMINAL_STATUSES.includes(status) && !existing?.resolvedAt
          ? new Date()
          : undefined,
    },
  });

  if (existing && existing.status !== status) {
    await notifyClaimStatusChanged({
      email: existing.email,
      fullName: existing.fullName,
      orderNumber: existing.shopifyOrderName ?? existing.orderNumber,
      status,
    });
  }

  return { ok: true };
};

export default function Claims() {
  const {
    claims,
    openClaims,
    resolvedClaims,
    totalClaims,
    filteredCount,
    tab,
    q,
    page,
    totalPages,
    emailClaimNumbers,
  } = useLoaderData<typeof loader>();
  const claimFetcher = useFetcher();
  const [searchParams] = useSearchParams();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const updateStatus = (claimId: string, status: string) => {
    // Resolving or denying emails the customer immediately, so confirm the
    // terminal transitions — an accidental dropdown change shouldn't send mail.
    if (TERMINAL_STATUSES.includes(status)) {
      const message =
        status === "resolved"
          ? "Mark this claim resolved? The customer will be emailed that their claim was resolved."
          : "Deny this claim? The customer will be emailed that their claim was not approved.";
      if (!window.confirm(message)) return;
    }
    claimFetcher.submit({ claimId, status }, { method: "POST" });
  };

  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("tab", tab);
    if (q) params.set("q", q);
    if (targetPage > 1) params.set("page", String(targetPage));
    const query = params.toString();
    return query ? `/app/claims?${query}` : "/app/claims";
  };

  const exportParams = new URLSearchParams(searchParams);

  return (
    <s-page>
      <PageHeader
        title="Claims"
        subtitle="Review and resolve claims submitted from your storefront's protection widget."
        actions={
          <>
            <AppButton href="/app/protection" variant="secondary">
              Protection settings
            </AppButton>
            <AppButton href="/app" variant="secondary">
              Back
            </AppButton>
          </>
        }
      />
      <WorkspaceTabs active="claims" />

      <div
        className="app-card-row"
        style={{ marginBottom: "1.25rem" }}
      >
        <StatTile
          icon="clock"
          label="Open claims"
          tone={openClaims > 0 ? "warning" : "default"}
          value={String(openClaims)}
        />
        <StatTile
          icon="check-circle"
          label="Resolved"
          tone="success"
          value={String(resolvedClaims)}
        />
      </div>

      <Card heading={`Claims (${totalClaims})`}>
        <s-stack
          direction="inline"
          gap="small-200"
          alignItems="center"
          justifyContent="space-between"
          paddingBlockEnd="base"
        >
          <s-stack direction="inline" gap="small-200">
            {TABS.map((t) => (
              <AppButton
                key={t.value}
                variant={tab === t.value ? "primary" : "secondary"}
                href={
                  t.value === "all"
                    ? "/app/claims"
                    : `/app/claims?tab=${t.value}`
                }
              >
                {t.label}
              </AppButton>
            ))}
          </s-stack>
          <AppButton
            href={`/app/claims/export?${exportParams.toString()}`}
            variant="secondary"
            download
          >
            Export CSV
          </AppButton>
        </s-stack>

        <Form method="get" className="app-search">
          <input type="hidden" name="tab" value={tab} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search order, name, or email"
            aria-label="Search claims"
            className="app-input"
          />
          <AppButton type="submit" variant="secondary">
            Search
          </AppButton>
          {q ? (
            <AppButton
              href={tab === "all" ? "/app/claims" : `/app/claims?tab=${tab}`}
              variant="secondary"
            >
              Clear
            </AppButton>
          ) : null}
        </Form>

        {claims.length === 0 ? (
          <EmptyState
            icon="clipboard-checklist"
            heading={q ? "No matching claims" : "No claims here"}
            description={
              q
                ? `Nothing matches “${q}”. Try a different order number, name, or email.`
                : "Nothing matches this filter yet."
            }
          />
        ) : (
          <>
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Issue</s-table-header>
              <s-table-header>Flags</s-table-header>
              <s-table-header>Submitted</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {claims.map((claim) => {
                const claimNumberForEmail = emailClaimNumbers[claim.email] ?? 1;
                return (
                  <s-table-row key={claim.id}>
                    <s-table-cell>
                      {claim.shopifyOrderId ? (
                        <s-link
                          href={`shopify://admin/orders/${claim.shopifyOrderId.split("/").pop()}`}
                          target="_top"
                        >
                          {claim.shopifyOrderName ?? claim.orderNumber}
                        </s-link>
                      ) : (
                        <s-link
                          href={`shopify://admin/orders?query=${encodeURIComponent(claim.orderNumber)}`}
                          target="_top"
                        >
                          {claim.orderNumber}
                        </s-link>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {claim.fullName}
                      <br />
                      <s-text color="subdued">{claim.email}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      {issueTypeLabel(claim.issueType)}
                      {claim.evidenceUrl && (
                        <>
                          <br />
                          <AppButton
                            variant="secondary"
                            command="--show"
                            commandFor="kourify-evidence-modal"
                            onClick={() => setPreviewUrl(claim.evidenceUrl)}
                          >
                            View photo
                          </AppButton>
                        </>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-200">
                        {claimNumberForEmail > 1 && (
                          <s-badge tone="warning">
                            {ordinal(claimNumberForEmail)} claim from this email
                          </s-badge>
                        )}
                        {claim.orderRiskLevel &&
                          claim.orderRiskLevel !== "LOW" && (
                            <s-badge tone="critical">
                              {claim.orderRiskLevel} risk order
                            </s-badge>
                          )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {new Date(claim.createdAt).toLocaleDateString()}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-200">
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "88px 160px",
                            alignItems: "center",
                            columnGap: "12px",
                            minInlineSize: "260px",
                          }}
                        >
                          <div style={{ inlineSize: "88px" }}>
                            <StatusBadge status={claim.status} />
                          </div>
                          <div
                            style={{
                              inlineSize: "160px",
                              minInlineSize: "160px",
                              maxInlineSize: "160px",
                            }}
                          >
                            <s-select
                              label="Status"
                              labelAccessibilityVisibility="exclusive"
                              value={claim.status}
                              onChange={(e) =>
                                updateStatus(
                                  claim.id,
                                  e.currentTarget.value ?? claim.status,
                                )
                              }
                            >
                              {STATUSES.map((status) => (
                                <s-option key={status} value={status}>
                                  {status.charAt(0).toUpperCase() +
                                    status.slice(1)}
                                </s-option>
                              ))}
                            </s-select>
                          </div>
                        </div>
                        {claim.status === "resolved" &&
                          claim.shopifyOrderId && (
                            <s-link
                              href={`shopify://admin/orders/${claim.shopifyOrderId.split("/").pop()}`}
                              target="_top"
                            >
                              Process refund/replacement →
                            </s-link>
                          )}
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
          {totalPages > 1 && (
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
              paddingBlockStart="base"
            >
              <s-text color="subdued">
                Page {page} of {totalPages} · {filteredCount} claim
                {filteredCount === 1 ? "" : "s"}
              </s-text>
              <s-stack direction="inline" gap="small-200">
                <AppButton
                  variant="secondary"
                  disabled={page <= 1}
                  href={page > 1 ? pageHref(page - 1) : undefined}
                >
                  Previous
                </AppButton>
                <AppButton
                  variant="secondary"
                  disabled={page >= totalPages}
                  href={page < totalPages ? pageHref(page + 1) : undefined}
                >
                  Next
                </AppButton>
              </s-stack>
            </s-stack>
          )}
          </>
        )}
      </Card>

      <s-modal id="kourify-evidence-modal" heading="Evidence photo">
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Claim evidence"
            style={{ maxWidth: "100%", borderRadius: "8px" }}
          />
        )}
      </s-modal>
    </s-page>
  );
}
