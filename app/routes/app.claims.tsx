import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "all";

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

  const [claims, allClaimsForCounts, openClaims, resolvedClaims] = await Promise.all([
    db.protectionClaim.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.protectionClaim.findMany({
      where: { shop: session.shop },
      select: { email: true, createdAt: true, resolvedAt: true },
    }),
    db.protectionClaim.count({
      where: { shop: session.shop, status: { in: ["submitted", "reviewing"] } },
    }),
    db.protectionClaim.count({
      where: { shop: session.shop, status: "resolved" },
    }),
  ]);

  return {
    claims,
    openClaims,
    resolvedClaims,
    totalClaims: allClaimsForCounts.length,
    tab,
    emailClaimNumbers: allClaimsForCounts
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .reduce<Record<string, number>>((acc, c) => {
        acc[c.email] = (acc[c.email] ?? 0) + 1;
        return acc;
      }, {}),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const claimId = String(formData.get("claimId"));
  const status = String(formData.get("status"));

  const existing = await db.protectionClaim.findFirst({
    where: { id: claimId, shop: session.shop },
  });

  await db.protectionClaim.updateMany({
    where: { id: claimId, shop: session.shop },
    data: {
      status,
      resolvedAt:
        TERMINAL_STATUSES.includes(status) && !existing?.resolvedAt ? new Date() : undefined,
    },
  });

  if (existing && existing.status !== status) {
    notifyClaimStatusChanged({
      email: existing.email,
      fullName: existing.fullName,
      orderNumber: existing.shopifyOrderName ?? existing.orderNumber,
      status,
    });
  }

  return { ok: true };
};

export default function Claims() {
  const { claims, openClaims, resolvedClaims, totalClaims, tab, emailClaimNumbers } =
    useLoaderData<typeof loader>();
  const claimFetcher = useFetcher();
  const [searchParams] = useSearchParams();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const updateStatus = (claimId: string, status: string) => {
    claimFetcher.submit({ claimId, status }, { method: "POST" });
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

      <div className="app-card-row" style={{ marginTop: "1.25rem", marginBottom: "1.25rem" }}>
        <StatTile
          icon="clock"
          label="Open claims"
          tone={openClaims > 0 ? "warning" : "default"}
          value={String(openClaims)}
        />
        <StatTile icon="check-circle" label="Resolved" tone="success" value={String(resolvedClaims)} />
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
                href={t.value === "all" ? "/app/claims" : `/app/claims?tab=${t.value}`}
              >
                {t.label}
              </AppButton>
            ))}
          </s-stack>
          <AppButton href={`/app/claims/export?${exportParams.toString()}`} variant="secondary">
            Export CSV
          </AppButton>
        </s-stack>

        {claims.length === 0 ? (
          <EmptyState
            icon="clipboard-checklist"
            heading="No claims here"
            description="Nothing matches this filter yet."
          />
        ) : (
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
                        {claim.orderRiskLevel && claim.orderRiskLevel !== "LOW" && (
                          <s-badge tone="critical">{claim.orderRiskLevel} risk order</s-badge>
                        )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {new Date(claim.createdAt).toLocaleDateString()}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-200">
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <StatusBadge status={claim.status} />
                          <div style={{ inlineSize: "140px", flex: "0 0 auto" }}>
                            <s-select
                              label="Status"
                              labelAccessibilityVisibility="exclusive"
                              value={claim.status}
                              onChange={(e: any) => updateStatus(claim.id, e.target.value)}
                            >
                              {STATUSES.map((status) => (
                                <s-option key={status} value={status}>
                                  {status.charAt(0).toUpperCase() + status.slice(1)}
                                </s-option>
                              ))}
                            </s-select>
                          </div>
                        </s-stack>
                        {claim.status === "resolved" && claim.shopifyOrderId && (
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
        )}
      </Card>

      <s-modal id="kourify-evidence-modal" heading="Evidence photo">
        {previewUrl && (
          <img src={previewUrl} alt="Claim evidence" style={{ maxWidth: "100%", borderRadius: "8px" }} />
        )}
      </s-modal>
    </s-page>
  );
}
