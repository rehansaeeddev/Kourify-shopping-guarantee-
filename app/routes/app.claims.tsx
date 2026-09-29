import { useEffect, useRef, useState } from "react";
import { Form, useNavigate, useSearchParams } from "react-router";

import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageError, PageSkeleton } from "../components/PageState";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import { useTablePagination } from "../hooks/useTablePagination";
import { api } from "../lib/api";
import { issueTypeLabel } from "../lib/claim-issue-type";
import { EVIDENCE_REQUIRED_TYPES } from "../lib/claim-window";
import { useBulkUpdateClaims, useClaims, useUpdateClaim } from "../lib/queries";

const STATUS_CONFIRM_MODAL_ID = "kourify-status-confirm-modal";
const STATUSES = ["submitted", "reviewing", "resolved", "denied"] as const;
const TERMINAL_STATUSES = ["resolved", "denied"];

/** The tab a URL asks for, or "all" when it names one that does not exist. */
function pickTab(value: string | null): string {
  return TABS.some((tab) => tab.value === value) ? (value as string) : "all";
}

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

export default function Claims() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const params = {
    tab: pickTab(searchParams.get("tab")),
    q: searchParams.get("q") ?? "",
    page: Math.max(1, Math.floor(Number(searchParams.get("page")) || 1)),
  };

  const { data, isPending, error, refetch } = useClaims(params);
  const updateClaim = useUpdateClaim();
  const bulkUpdate = useBulkUpdateClaims();

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Bulk status changes ride their own fetcher. A confirmation modal (not a raw
  // browser confirm, which leaks the tunnel URL inside the embedded admin) gates
  // the send, and the outcome lands in a dismissible banner at the top of the
  // page, matching the single-claim decision flow. Selection is scoped to the
  // claims visible on this page and clears whenever the list changes.
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
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    setSelectedClaimIds(new Set());
  }, [params.tab, params.q, params.page]);

  if (isPending) return <PageSkeleton heading="Claims" />;
  if (error)
    return <PageError heading="Claims" error={error} onRetry={refetch} />;

  const {
    claims,
    openClaims,
    resolvedClaims,
    totalClaims,
    totalPages,
    pageSize,
    filteredCount,
    workspaceCounts,
    emailClaimNumbers,
  } = data;
  const { tab, q, page } = params;

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

    bulkUpdate.mutate(
      {
        claimIds: Array.from(selectedClaimIds),
        status: pendingBulk.status,
      },
      {
        onSuccess: (result) =>
          setBulkBanner({
            text: result.message ?? "Claims updated.",
            ok: result.ok,
          }),
        onError: (cause) => setBulkBanner({ text: cause.message, ok: false }),
      },
    );
    setSelectedClaimIds(new Set());
    setPendingBulk(null);
    bulkConfirmRef.current?.hideOverlay();
  };

  const cancelBulkConfirm = () => {
    setPendingBulk(null);
    bulkConfirmRef.current?.hideOverlay();
  };

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
  const [statusBanner, setStatusBanner] = useState<StatusOutcome | null>(null);

  const submitStatus = (
    claimId: string,
    status: string,
    settlementCents?: number | null,
  ) => {
    // Captured before the call: the refetch that follows flips this claim's
    // status, and the banner would have nothing left to name.
    const claim = claims.find((row) => row.id === claimId);
    const outcome: StatusOutcome | null = TERMINAL_STATUSES.includes(status)
      ? {
          status,
          orderName: claim?.shopifyOrderName ?? claim?.orderNumber ?? "",
          shopifyOrderId: claim?.shopifyOrderId ?? null,
        }
      : null;

    updateClaim.mutate(
      {
        id: claimId,
        status,
        ...(settlementCents != null ? { settlementCents } : {}),
      },
      {
        // Resolving or denying emails the customer, so it gets a banner that
        // stays; moving a claim to "reviewing" tells nobody and needs none.
        onSuccess: () => outcome && setStatusBanner(outcome),
        onError: (cause) => showToast(cause.message, { isError: true }),
      },
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

  const exportCsv = () =>
    api
      .download(
        `/claims/export?${new URLSearchParams(searchParams).toString()}`,
        "kourify-claims.csv",
      )
      .catch((cause: Error) => showToast(cause.message, { isError: true }));

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
        <s-stack direction="block" gap="base">
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
            <s-button variant="secondary" onClick={exportCsv}>
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
                <s-stack direction="inline" gap="small-200" alignItems="center">
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
                      {`Showing ${(page - 1) * pageSize + 1}–${
                        (page - 1) * pageSize + claims.length
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
                      loading={bulkUpdate.isPending}
                      disabled={bulkUpdate.isPending}
                      onClick={() => openBulkConfirm("reviewing")}
                    >
                      Mark reviewing
                    </s-button>
                    <s-button
                      variant="primary"
                      loading={bulkUpdate.isPending}
                      disabled={bulkUpdate.isPending}
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
          loading={bulkUpdate.isPending}
          disabled={bulkUpdate.isPending}
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
