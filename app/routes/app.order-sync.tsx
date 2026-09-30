import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { Card, MetricsCard } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageError, PageSkeleton } from "../components/PageState";
import { useToast } from "../components/Toast";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import { useTablePagination } from "../hooks/useTablePagination";
import { useOrderSync, useStartOrderSync } from "../lib/queries";
import { PageBody } from "../components/PageBody";

const SYNC_JOB_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export default function OrderSync() {
  const [searchParams] = useSearchParams();
  const page = Math.max(1, Math.floor(Number(searchParams.get("page")) || 1));

  /*
   * This is the one query in the admin that polls: a backfill finishes
   * asynchronously, when Shopify's bulk_operations/finish webhook lands, so
   * nothing the merchant does here tells the page it is done. The hook stops
   * polling on its own once no job is in flight.
   */
  const { data, isPending, error, refetch } = useOrderSync(page);
  const startSync = useStartOrderSync();
  const { showToast } = useToast();

  const jobPageHref = (targetPage: number) =>
    targetPage > 1 ? `/app/order-sync?page=${targetPage}` : "/app/order-sync";
  const jobPagination = useTablePagination(
    page,
    data?.totalPages ?? 1,
    jobPageHref,
  );

  const hasActiveJob = (data?.activeJobCount ?? 0) > 0;
  // Read before the loading guard below, because the effect that watches it
  // has to be declared unconditionally.
  const loadedJobs = data?.jobs;

  // When a job that was running flips to done, surface the outcome in a banner
  // at the top of the page so the merchant sees the sync finished without
  // reading the jobs table.
  const wasActive = useRef(false);
  const [syncBanner, setSyncBanner] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  useEffect(() => {
    if (hasActiveJob) {
      wasActive.current = true;
      return;
    }
    if (wasActive.current && loadedJobs) {
      const latest = loadedJobs[0];
      if (latest?.status === "failed") {
        setSyncBanner({
          ok: false,
          text: latest.errorMessage ?? "Order sync failed.",
        });
      } else {
        const count = latest?.objectCount ?? 0;
        setSyncBanner({
          ok: true,
          text: `Order sync complete — ${count} order${count === 1 ? "" : "s"} synced.`,
        });
      }
      wasActive.current = false;
    }
  }, [hasActiveJob, loadedJobs]);

  if (isPending) return <PageSkeleton heading="Order sync" />;
  if (error)
    return <PageError heading="Order sync" error={error} onRetry={refetch} />;

  const {
    orderCount,
    lastSyncedAt,
    enabled: orderSyncEnabled,
    workspaceCounts,
    jobs,
    jobCount,
  } = data;

  const syncing = startSync.isPending || hasActiveJob;

  const lastUpdated = lastSyncedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(lastSyncedAt))
    : "Never";

  const runSync = () =>
    startSync.mutate(undefined, {
      onSuccess: () =>
        showToast(
          "Order sync started — this can take a few minutes for large stores.",
        ),
      onError: (cause) => showToast(cause.message, { isError: true }),
    });

  return (
    <s-page inlineSize="large" heading="Order sync">
      <WorkspaceTabs
        active="order-sync"
        counts={{
          orders: workspaceCounts.ordersNeedingAction,
          claims: workspaceCounts.openClaims,
        }}
      />
      <s-button slot="secondary-actions" href="/app" variant="secondary">
        Back to home
      </s-button>
      <PageBody>
        {syncBanner ? (
          <s-banner
            tone={syncBanner.ok ? "success" : "critical"}
            heading={
              syncBanner.ok ? "Order sync complete" : "Order sync failed"
            }
            dismissible
            onDismiss={() => setSyncBanner(null)}
          >
            {syncBanner.text}
          </s-banner>
        ) : null}

        <MetricsCard
          heading="Sync status"
          description="Keep the order cache used for claim verification up to date."
          metrics={[
            {
              // A configured sync mode is a neutral fact, not a warning.
              icon: "check-circle",
              label: "Sync mode",
              value: orderSyncEnabled ? "Manual" : "Approval required",
            },
            {
              icon: "order",
              label: "Cached orders",
              value: String(orderCount),
            },
            { icon: "clock", label: "Last cache update", value: lastUpdated },
          ]}
        />

        <Card heading="Manual synchronization">
          <s-stack gap="base">
            {!orderSyncEnabled ? (
              /* Says what is true.
                Shopify is not blocking anything at this moment — this app has
                the feature switched off, and ORDER_SYNC_ENABLED defaults to
                false. Telling a merchant that Shopify is refusing them sends
                them looking in the wrong place for a setting they cannot
                reach anyway. */
              <s-banner heading="Order sync is turned off" tone="warning">
                The import reads customer email addresses, which Shopify gates
                behind Protected Customer Data approval, so it stays off until
                that approval is granted for this app. Request it under App
                setup → Protected customer data in the Partner Dashboard, then
                set ORDER_SYNC_ENABLED=true on the server.
              </s-banner>
            ) : (
              <s-paragraph>
                Import available existing orders now. Runs as a background job
                on Shopify&apos;s side, so it&apos;s safe to use even with tens
                of thousands of orders. Automatic order webhooks remain off, so
                use this button whenever orders change.
              </s-paragraph>
            )}
            {startSync.error ? (
              <s-banner tone="critical">{startSync.error.message}</s-banner>
            ) : null}
            <s-stack direction="inline">
              <s-button
                variant="primary"
                loading={syncing}
                disabled={syncing || !orderSyncEnabled}
                onClick={runSync}
              >
                {!orderSyncEnabled
                  ? "Order access required"
                  : syncing
                    ? "Sync running…"
                    : "Sync orders now"}
              </s-button>
            </s-stack>
          </s-stack>
        </Card>

        <Card heading={`Sync jobs (${jobCount})`}>
          {jobs.length === 0 ? (
            <EmptyState
              icon="clock"
              heading="No sync jobs yet"
              description="Run a manual sync and each job will appear here."
            />
          ) : (
            <s-table
              ref={jobPagination.ref as never}
              variant="auto"
              paginate={jobPagination.paginate}
              hasPreviousPage={jobPagination.hasPreviousPage}
              hasNextPage={jobPagination.hasNextPage}
            >
              <s-table-header-row>
                <s-table-header listSlot="primary">Status</s-table-header>
                <s-table-header listSlot="secondary">Date</s-table-header>
                <s-table-header listSlot="labeled">Result</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {jobs.map((job) => (
                  <s-table-row key={job.id}>
                    <s-table-cell>
                      <s-badge
                        tone={
                          job.status === "completed"
                            ? "success"
                            : job.status === "failed"
                              ? "critical"
                              : // A running job is informational, not a warning.
                                "info"
                        }
                      >
                        {SYNC_JOB_STATUS_LABEL[job.status] ?? job.status}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(job.createdAt))}
                    </s-table-cell>
                    <s-table-cell>
                      {job.status === "completed"
                        ? `${job.objectCount ?? 0} orders`
                        : job.status === "failed"
                          ? (job.errorMessage ?? "Failed")
                          : "In progress…"}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </Card>
      </PageBody>
    </s-page>
  );
}
