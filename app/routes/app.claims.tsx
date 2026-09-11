import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import {
  Form,
  useFetcher,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Card } from "../components/Card";
import { getResolvedClaimsTrend } from "../lib/protection-telemetry.server";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import { issueTypeLabel } from "../lib/claim-issue-type";
import { EVIDENCE_REQUIRED_TYPES } from "../lib/claim-window";
import { notifyClaimStatusChanged } from "../lib/notify.server";
import { isRateLimited } from "../lib/rate-limit.server";
import { useTablePagination } from "../hooks/useTablePagination";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import { getWorkspaceCounts } from "../lib/workspace-counts.server";

const STATUS_CONFIRM_MODAL_ID = "kourify-status-confirm-modal";
const STATUSES = ["submitted", "reviewing", "resolved", "denied"] as const;
const TERMINAL_STATUSES = ["resolved", "denied"];

const TABS = [
  { value: "all", label: "All" },
  { value: "requires_evidence", label: "Requires evidence" },
  { value: "high_risk", label: "High risk" },
  { value: "resolved_today", label: "Resolved today" },
] as const;

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

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
  const page = Math.max(
    1,
    Math.floor(Number(url.searchParams.get("page")) || 1),
  );

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
    resolvedTrend,
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
    getResolvedClaimsTrend(session.shop),
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const workspaceCounts = await getWorkspaceCounts(session.shop);

  // Claimed item titles for this page. protectedItemId is a plain nullable
  // column rather than a Prisma relation — claims filed before item-level
  // coverage have none — so this is one scoped follow-up read, not an include.
  const itemIds = claims
    .map((claim) => claim.protectedItemId)
    .filter((id): id is string => Boolean(id));
  const itemsById = new Map(
    itemIds.length
      ? (
          await db.protectedOrderItem.findMany({
            where: { shop: session.shop, id: { in: itemIds } },
            select: { id: true, title: true, sku: true },
          })
        ).map((item) => [item.id, item])
      : [],
  );
  const claimsWithItems = claims.map((claim) => ({
    ...claim,
    protectedItem: claim.protectedItemId
      ? (itemsById.get(claim.protectedItemId) ?? null)
      : null,
  }));

  return {
    claims: claimsWithItems,
    openClaims,
    resolvedClaims,
    resolvedTrend,
    totalClaims,
    filteredCount,
    tab,
    q,
    page,
    totalPages,
    workspaceCounts,
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

  // Apply one status change: persist it, record the audit trail, and email the
  // customer. Shared by the single-row update and the bulk update so the
  // money-and-email-sensitive path exists in exactly one place. `existing` is
  // the claim as it was before the change (null if it no longer exists).
  const applyStatusChange = async (
    claimId: string,
    existing: NonNullable<
      Awaited<ReturnType<typeof db.protectionClaim.findFirst>>
    > | null,
    status: string,
    settlementCents: number | null | undefined,
    decisionNote: string | undefined,
  ) => {
    const isDecision = TERMINAL_STATUSES.includes(status);
    const actor = session.onlineAccessInfo?.associated_user;
    const decidedByUserId = actor?.id != null ? String(actor.id) : null;
    const decidedByName =
      [actor?.first_name, actor?.last_name].filter(Boolean).join(" ") ||
      actor?.email ||
      null;

    await db.protectionClaim.updateMany({
      where: { id: claimId, shop: session.shop },
      data: {
        status,
        ...(settlementCents !== undefined ? { settlementCents } : {}),
        ...(decisionNote !== undefined ? { decisionNote } : {}),
        ...(isDecision ? { decidedByUserId, decidedByName } : {}),
        resolvedAt:
          isDecision && !existing?.resolvedAt ? new Date() : undefined,
      },
    });

    if (existing && existing.status !== status) {
      await db.auditLog.create({
        data: {
          shop: session.shop,
          action: isDecision ? "claim_decision" : "claim_status_updated",
          userId: decidedByUserId,
          resource: `claim:${claimId}`,
          oldValue: {
            status: existing.status,
            settlementCents: existing.settlementCents,
          },
          newValue: {
            status,
            settlementCents:
              settlementCents !== undefined
                ? settlementCents
                : existing.settlementCents,
            eligibleLossCents: existing.eligibleLossCents,
            decidedByName,
            ...(decisionNote !== undefined ? { decisionNote } : {}),
          },
        },
      });
      await notifyClaimStatusChanged({
        email: existing.email,
        fullName: existing.fullName,
        orderNumber: existing.shopifyOrderName ?? existing.orderNumber,
        status,
      });
    }
  };

  // Bulk status change: only the non-destructive transitions are allowed here
  // (a denial always goes through the single-row flow), and each one still
  // emails its customer, so the client confirms before submitting.
  const bulkClaimIds = String(formData.get("claimIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (bulkClaimIds.length) {
    const status = String(formData.get("status"));
    if (!["reviewing", "resolved"].includes(status)) {
      return { ok: false, error: "That status can't be set in bulk." };
    }
    if (bulkClaimIds.length > 50) {
      return { ok: false, error: "Update at most 50 claims at a time." };
    }
    const claims = await db.protectionClaim.findMany({
      where: { id: { in: bulkClaimIds }, shop: session.shop },
    });
    let changed = 0;
    let skipped = bulkClaimIds.length - claims.length; // ids that no longer exist
    for (const existing of claims) {
      // Already in the target status — nothing to change, nothing to email.
      if (existing.status === status) {
        skipped += 1;
        continue;
      }
      await applyStatusChange(existing.id, existing, status, undefined, undefined);
      changed += 1;
    }
    const parts = [`Updated ${changed} claim${changed === 1 ? "" : "s"}`];
    if (skipped) parts.push(`skipped ${skipped}`);
    return { ok: changed > 0, message: parts.join(" · ") };
  }

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

  // Settlement amount — what the merchant approves and funds. Only meaningful
  // on approval, and capped at the eligible loss Kourify calculated so an
  // approval can't quietly exceed the item's own covered value. Kourify never
  // sets this itself; absent merchant input it stays null.
  let settlementCents: number | null | undefined;
  if (status === "resolved") {
    const raw = formData.get("settlementCents");
    if (raw !== null && String(raw).trim() !== "") {
      const parsed = Math.max(0, Math.round(Number(raw) || 0));
      const ceiling = existing?.eligibleLossCents ?? null;
      if (ceiling != null && parsed > ceiling) {
        return {
          ok: false,
          error: `Settlement can't exceed the eligible loss of $${(ceiling / 100).toFixed(2)}.`,
        };
      }
      settlementCents = parsed;
    }
  } else if (status === "denied") {
    // A denial settles nothing.
    settlementCents = null;
  }

  const note = formData.get("decisionNote");
  const decisionNote =
    note !== null && String(note).trim() !== ""
      ? String(note).trim().slice(0, 2000)
      : undefined;

  await applyStatusChange(claimId, existing, status, settlementCents, decisionNote);

  return { ok: true };
};

export default function Claims() {
  const {
    claims,
    openClaims,
    resolvedClaims,
    totalClaims,
    tab,
    q,
    page,
    totalPages,
    filteredCount,
    workspaceCounts,
    emailClaimNumbers,
  } = useLoaderData<typeof loader>();
  const claimFetcher = useFetcher();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Bulk status changes ride their own fetcher. A confirmation modal (not a raw
  // browser confirm, which leaks the tunnel URL inside the embedded admin) gates
  // the send, and the outcome lands in a dismissible banner at the top of the
  // page, matching the single-claim decision flow. Selection is scoped to the
  // claims visible on this page and clears whenever the list changes.
  const bulkFetcher = useFetcher<typeof action>();
  const bulkConfirmRef = useRef<{
    showOverlay: () => void;
    hideOverlay: () => void;
  } | null>(null);
  const [pendingBulk, setPendingBulk] = useState<{
    status: "reviewing" | "resolved";
    count: number;
  } | null>(null);
  const [bulkBanner, setBulkBanner] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);
  const bulkWasActive = useRef(false);
  useEffect(() => {
    if (bulkFetcher.state !== "idle") {
      bulkWasActive.current = true;
      return;
    }
    if (bulkWasActive.current && bulkFetcher.data) {
      const data = bulkFetcher.data;
      setBulkBanner({
        text: data.message ?? data.error ?? "Claims updated.",
        ok: Boolean(data.ok),
      });
    }
    bulkWasActive.current = false;
  }, [bulkFetcher.state, bulkFetcher.data]);

  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    setSelectedClaimIds(new Set());
  }, [tab, q, page]);

  const pageClaimIds = claims.map((claim) => claim.id);
  const allClaimsSelected =
    pageClaimIds.length > 0 &&
    pageClaimIds.every((id) => selectedClaimIds.has(id));

  const toggleClaim = (id: string) =>
    setSelectedClaimIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllClaims = () =>
    setSelectedClaimIds((prev) =>
      pageClaimIds.every((id) => prev.has(id))
        ? new Set()
        : new Set(pageClaimIds),
    );

  const openBulkConfirm = (status: "reviewing" | "resolved") => {
    setPendingBulk({ status, count: selectedClaimIds.size });
    bulkConfirmRef.current?.showOverlay();
  };

  const confirmBulkStatus = () => {
    if (!pendingBulk) return;
    bulkFetcher.submit(
      {
        claimIds: Array.from(selectedClaimIds).join(","),
        status: pendingBulk.status,
      },
      { method: "POST" },
    );
    setSelectedClaimIds(new Set());
    setPendingBulk(null);
    bulkConfirmRef.current?.hideOverlay();
  };

  const cancelBulkConfirm = () => {
    setPendingBulk(null);
    bulkConfirmRef.current?.hideOverlay();
  };

  // Remembers which row was just submitted so the decision banner can name it
  // before the loader revalidates and the row's status flips.
  const submittedClaimId = useRef<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<{
    claimId: string;
    status: string;
    eligibleLossCents: number | null;
  } | null>(null);
  const [settlementInput, setSettlementInput] = useState("");
  const confirmModalRef = useRef<{
    showOverlay: () => void;
    hideOverlay: () => void;
  } | null>(null);

  type StatusOutcome = {
    status: string;
    orderName: string;
    shopifyOrderId: string | null;
  };
  const submittedOutcome = useRef<StatusOutcome | null>(null);
  const [statusBanner, setStatusBanner] = useState<StatusOutcome | null>(null);

  useEffect(() => {
    if (claimFetcher.state !== "idle" || !claimFetcher.data) return;
    if (!submittedClaimId.current) return;

    submittedClaimId.current = null;

    // Resolve/deny emails the customer, so it gets a persistent banner.
    if (submittedOutcome.current) {
      setStatusBanner(submittedOutcome.current);
      submittedOutcome.current = null;
    }
  }, [claimFetcher.state, claimFetcher.data]);

  const submitStatus = (
    claimId: string,
    status: string,
    settlementCents?: number | null,
  ) => {
    submittedClaimId.current = claimId;
    // Capture the row now: once the action lands the loader revalidates and
    // this claim's status flips, so the banner couldn't tell what changed.
    const claim = claims.find((row) => row.id === claimId);
    submittedOutcome.current = TERMINAL_STATUSES.includes(status)
      ? {
          status,
          orderName: claim?.shopifyOrderName ?? claim?.orderNumber ?? "",
          shopifyOrderId: claim?.shopifyOrderId ?? null,
        }
      : null;
    claimFetcher.submit(
      {
        claimId,
        status,
        ...(settlementCents != null
          ? { settlementCents: String(settlementCents) }
          : {}),
      },
      { method: "POST" },
    );
  };

  const updateStatus = (claimId: string, status: string) => {
    // Resolving or denying emails the customer immediately, so confirm the
    // terminal transitions — an accidental dropdown change shouldn't send mail.
    if (TERMINAL_STATUSES.includes(status)) {
      const claim = claims.find((row) => row.id === claimId);
      setPendingStatus({
        claimId,
        status,
        // Pre-fill approval with the full eligible loss. The merchant may
        // lower it; Kourify never decides the amount on their behalf.
        eligibleLossCents: claim?.eligibleLossCents ?? null,
      });
      setSettlementInput(
        claim?.eligibleLossCents != null
          ? (claim.eligibleLossCents / 100).toFixed(2)
          : "",
      );
      confirmModalRef.current?.showOverlay();
      return;
    }
    submitStatus(claimId, status);
  };

  const confirmStatusChange = () => {
    if (pendingStatus) {
      const settlement =
        pendingStatus.status === "resolved" && settlementInput.trim() !== ""
          ? Math.max(0, Math.round(Number(settlementInput) * 100))
          : null;
      submitStatus(pendingStatus.claimId, pendingStatus.status, settlement);
    }
    setPendingStatus(null);
    confirmModalRef.current?.hideOverlay();
  };

  const cancelStatusChange = () => {
    setPendingStatus(null);
    confirmModalRef.current?.hideOverlay();
  };

  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("tab", tab);
    if (q) params.set("q", q);
    if (targetPage > 1) params.set("page", String(targetPage));
    const query = params.toString();
    return query ? `/app/claims?${query}` : "/app/claims";
  };

  const pagination = useTablePagination(page, totalPages, pageHref);

  const exportParams = new URLSearchParams(searchParams);

  return (
    <s-page heading="Claims">
      <s-button
        slot="secondary-actions"
        href="/app/settings"
        variant="secondary"
      >
        Settings
      </s-button>
      <s-button slot="secondary-actions" href="/app" variant="secondary">
        Back
      </s-button>

      {bulkBanner && (
        <s-banner
          tone={bulkBanner.ok ? "success" : "critical"}
          heading={bulkBanner.ok ? "Claims updated" : "Couldn't update claims"}
          dismissible
          onDismiss={() => setBulkBanner(null)}
        >
          {bulkBanner.text}
        </s-banner>
      )}

      {statusBanner && (
        <s-banner
          tone={statusBanner.status === "resolved" ? "success" : "info"}
          heading={
            statusBanner.status === "resolved"
              ? `Claim ${statusBanner.orderName} resolved`
              : `Claim ${statusBanner.orderName} denied`
          }
          dismissible
          onDismiss={() => setStatusBanner(null)}
        >
          {statusBanner.status === "resolved"
            ? "The customer has been emailed to say their claim was approved."
            : "The customer has been emailed to say their claim wasn't approved."}
          {statusBanner.shopifyOrderId && (
            <s-button
              slot="primary-action"
              href={`shopify://admin/orders/${statusBanner.shopifyOrderId
                .split("/")
                .pop()}`}
              target="_top"
            >
              View order
            </s-button>
          )}
        </s-banner>
      )}

      <WorkspaceTabs
        active="claims"
        counts={{
          orders: workspaceCounts.ordersNeedingAction,
          claims: workspaceCounts.openClaims,
        }}
      />

      <Card heading={`Claims (${totalClaims})`}>
        {/* One block stack owns the card's vertical rhythm so the count line,
            filters, search and table each get even breathing room instead of
            butting up against one another. */}
        <s-stack direction="block" gap="large">
        {/* A compact count line, not a whole metrics card — two numbers don't
            earn their own section, and the open count already rides on the
            workspace tab. */}
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-badge tone={openClaims > 0 ? "warning" : "neutral"}>
            {`${openClaims} open`}
          </s-badge>
          <s-badge tone="neutral">{`${resolvedClaims} resolved`}</s-badge>
        </s-stack>
        {/* Search submits on Enter; the Status dropdown navigates on change,
            keeping the current search. */}
        <s-grid
          gridTemplateColumns="@container (inline-size <= 640px) 1fr, 1fr auto auto"
          gap="base"
          alignItems="end"
        >
          <Form method="get">
            {tab !== "all" ? (
              <input type="hidden" name="tab" value={tab} />
            ) : null}
            <s-search-field
              label="Search claims"
              labelAccessibilityVisibility="exclusive"
              name="q"
              value={q}
              placeholder="Search order, name, or email"
            />
          </Form>
          <s-box minInlineSize="180px">
            <s-select
              label="Status"
              value={tab}
              onChange={(e) => {
                const value = e.currentTarget.value ?? "all";
                const params = new URLSearchParams();
                if (value !== "all") params.set("tab", value);
                if (q) params.set("q", q);
                const search = params.toString();
                navigate(search ? `/app/claims?${search}` : "/app/claims");
              }}
            >
              {TABS.map((t) => (
                <s-option key={t.value} value={t.value}>
                  {t.label}
                </s-option>
              ))}
            </s-select>
          </s-box>
          <s-button
            href={`/app/claims/export?${exportParams.toString()}`}
            variant="secondary"
            download=""
            target="_blank"
          >
            Export CSV
          </s-button>
        </s-grid>
        </s-stack>
      </Card>

      <Card>
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
            {/* Fixed-height header bar so selecting never shifts the table:
                the select-all checkbox and count sit on the left, and the bulk
                actions appear on the right only once claims are selected — no
                disabled button lingers on top while nothing is selected. */}
            <s-box minBlockSize="44px">
              <s-stack
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-stack
                  direction="inline"
                  gap="small-200"
                  alignItems="center"
                >
                  <s-checkbox
                    checked={allClaimsSelected}
                    accessibilityLabel="Select all claims on this page"
                    onChange={toggleAllClaims}
                  />
                  {selectedClaimIds.size > 0 ? (
                    <s-text type="strong">
                      {`${selectedClaimIds.size} selected`}
                    </s-text>
                  ) : (
                    <s-text color="subdued">
                      {`Showing ${(page - 1) * PAGE_SIZE + 1}–${
                        (page - 1) * PAGE_SIZE + claims.length
                      } of ${filteredCount} claim${filteredCount === 1 ? "" : "s"}`}
                    </s-text>
                  )}
                </s-stack>
                {selectedClaimIds.size > 0 ? (
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-button
                      variant="secondary"
                      onClick={() => setSelectedClaimIds(new Set())}
                    >
                      Clear
                    </s-button>
                    <s-button
                      variant="secondary"
                      loading={bulkFetcher.state !== "idle"}
                      disabled={bulkFetcher.state !== "idle"}
                      onClick={() => openBulkConfirm("reviewing")}
                    >
                      Mark reviewing
                    </s-button>
                    <s-button
                      variant="primary"
                      loading={bulkFetcher.state !== "idle"}
                      disabled={bulkFetcher.state !== "idle"}
                      onClick={() => openBulkConfirm("resolved")}
                    >
                      Approve
                    </s-button>
                  </s-stack>
                ) : null}
              </s-stack>
            </s-box>
            <s-table
              ref={pagination.ref as never}
              variant="auto"
              paginate={pagination.paginate}
              hasPreviousPage={pagination.hasPreviousPage}
              hasNextPage={pagination.hasNextPage}
            >
              <s-table-header-row>
                <s-table-header listSlot="primary">Order</s-table-header>
                <s-table-header listSlot="secondary">Customer</s-table-header>
                <s-table-header listSlot="labeled">Issue</s-table-header>
                <s-table-header listSlot="labeled">Loss</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {claims.map((claim) => {
                  const claimNumberForEmail =
                    emailClaimNumbers[claim.email] ?? 1;
                  return (
                    <s-table-row key={claim.id}>
                      <s-table-cell>
                        <s-stack
                          direction="inline"
                          gap="small-200"
                          alignItems="start"
                        >
                          <s-checkbox
                            checked={selectedClaimIds.has(claim.id)}
                            accessibilityLabel={`Select claim ${claim.orderNumber}`}
                            onChange={() => toggleClaim(claim.id)}
                          />
                          <s-stack direction="block" gap="small-100">
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
                            <s-text color="subdued">
                              {new Date(claim.createdAt).toLocaleDateString()}
                            </s-text>
                          </s-stack>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="block" gap="small-100">
                          <s-text>{claim.fullName}</s-text>
                          <s-text color="subdued">{claim.email}</s-text>
                          {claimNumberForEmail > 1 && (
                            <s-stack direction="inline">
                              <s-badge tone="warning">
                                {`${ordinal(claimNumberForEmail)} claim from this email`}
                              </s-badge>
                            </s-stack>
                          )}
                          {claim.orderRiskLevel &&
                            claim.orderRiskLevel !== "LOW" && (
                              <s-stack direction="inline">
                                <s-badge tone="critical">
                                  {`${claim.orderRiskLevel.charAt(0)}${claim.orderRiskLevel
                                    .slice(1)
                                    .toLowerCase()} risk order`}
                                </s-badge>
                              </s-stack>
                            )}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        {issueTypeLabel(claim.issueType)}
                        {claim.evidenceUrl && (
                          <>
                            <br />
                            <s-button
                              variant="secondary"
                              command="--show"
                              commandFor="kourify-evidence-modal"
                              onClick={() => setPreviewUrl(claim.evidenceUrl)}
                            >
                              View photo
                            </s-button>
                          </>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="block" gap="small-100">
                          <s-text
                            type="strong"
                            fontVariantNumeric="tabular-nums"
                          >
                            {claim.eligibleLossCents != null
                              ? money(claim.eligibleLossCents)
                              : "—"}
                          </s-text>
                          {claim.protectedItem && (
                            <s-text color="subdued">
                              {`${claim.protectedItem.title} · ${claim.claimedQuantity ?? 1} × ${money(claim.itemValueCents ?? 0)}`}
                            </s-text>
                          )}
                          {claim.settlementCents != null && (
                            <s-text color="subdued">
                              {`Approved ${money(claim.settlementCents)}`}
                            </s-text>
                          )}
                        </s-stack>
                      </s-table-cell>

                      <s-table-cell>
                        <s-stack direction="block" gap="small-100">
                          {/* The badge shows the status at a glance; the menu
                              changes it — so the column no longer stacks a badge
                              above a full-width select that said the same thing. */}
                          <s-stack
                            direction="inline"
                            gap="small-100"
                            alignItems="center"
                          >
                            <StatusBadge status={claim.status} />
                            <s-button
                              variant="tertiary"
                              icon="menu-horizontal"
                              accessibilityLabel={`Change status for ${claim.orderNumber}`}
                              commandFor={`status-menu-${claim.id}`}
                              command="--show"
                            ></s-button>
                            <s-menu
                              id={`status-menu-${claim.id}`}
                              accessibilityLabel="Change status"
                            >
                              {STATUSES.map((status) => (
                                <s-button
                                  key={status}
                                  variant="tertiary"
                                  onClick={() => updateStatus(claim.id, status)}
                                >
                                  {status.charAt(0).toUpperCase() +
                                    status.slice(1)}
                                </s-button>
                              ))}
                            </s-menu>
                          </s-stack>
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
          </>
        )}
      </Card>

      <s-modal
        ref={confirmModalRef as never}
        id={STATUS_CONFIRM_MODAL_ID}
        heading={
          pendingStatus?.status === "resolved" ? "Resolve claim" : "Deny claim"
        }
      >
        <s-paragraph>
          {pendingStatus?.status === "resolved"
            ? "The customer will be emailed straight away to say their claim was approved. This can't be undone."
            : "The customer will be emailed straight away to say their claim wasn't approved. This can't be undone."}
        </s-paragraph>

        {pendingStatus?.status === "resolved" && (
          <s-stack direction="block" gap="small-200" paddingBlockStart="base">
            <s-number-field
              label="Settlement amount you'll fund"
              prefix="$"
              min={0}
              step={0.01}
              value={settlementInput}
              onChange={(e) => setSettlementInput(e.currentTarget.value ?? "")}
            />
            <s-text color="subdued">
              {pendingStatus.eligibleLossCents != null
                ? `Eligible loss is ${money(pendingStatus.eligibleLossCents)}. You can approve less, but not more. Leave empty to record no amount.`
                : "This claim predates item-level coverage, so there's no calculated eligible loss. Enter the amount you're funding, or leave empty."}
            </s-text>
          </s-stack>
        )}
        <s-button
          slot="primary-action"
          variant="primary"
          tone={pendingStatus?.status === "denied" ? "critical" : "auto"}
          onClick={confirmStatusChange}
        >
          {pendingStatus?.status === "resolved"
            ? "Resolve and notify"
            : "Deny and notify"}
        </s-button>
        <s-button slot="secondary-actions" onClick={cancelStatusChange}>
          Cancel
        </s-button>
      </s-modal>

      <s-modal
        ref={bulkConfirmRef as never}
        id="kourify-bulk-status-modal"
        heading={
          pendingBulk?.status === "resolved"
            ? `Approve ${pendingBulk.count} claim${pendingBulk.count === 1 ? "" : "s"}?`
            : `Mark ${pendingBulk?.count ?? 0} claim${pendingBulk?.count === 1 ? "" : "s"} reviewing?`
        }
      >
        <s-paragraph>
          {pendingBulk?.status === "resolved"
            ? "Each customer is emailed straight away to say their claim was approved. Claims already resolved are skipped, and this can't be undone."
            : "Each customer is emailed to say their claim is now being reviewed. Claims already in review are skipped."}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={bulkFetcher.state !== "idle"}
          disabled={bulkFetcher.state !== "idle"}
          onClick={confirmBulkStatus}
        >
          {pendingBulk?.status === "resolved"
            ? "Approve and notify"
            : "Mark reviewing and notify"}
        </s-button>
        <s-button slot="secondary-actions" onClick={cancelBulkConfirm}>
          Cancel
        </s-button>
      </s-modal>

      <s-modal id="kourify-evidence-modal" heading="Evidence photo">
        {previewUrl && (
          <s-image src={previewUrl} alt="Claim evidence" objectFit="contain" />
        )}
      </s-modal>
    </s-page>
  );
}
