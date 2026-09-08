import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { useEffect } from "react";
import { AppButton } from "../components/AppButton";
import { Card, StatTile } from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import { useFetcherToast } from "../hooks/useFetcherToast";
import db from "../db.server";
import { startOrderBulkSync } from "../lib/order-bulk-sync.server";
import { isRateLimited } from "../lib/rate-limit.server";
import { authenticate } from "../shopify.server";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import { getWorkspaceCounts } from "../lib/workspace-counts.server";

type SyncResult = {
  ok: boolean;
  error?: string;
};

type SyncJobView = {
  id: string;
  status: string;
  objectCount: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

const SYNC_JOB_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const [orderCount, latestOrder, jobs] = await Promise.all([
    db.order.count({ where: { shop: session.shop } }),
    db.order.findFirst({
      where: { shop: session.shop },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.syncJob.findMany({
      where: { shop: session.shop, type: "order_backfill" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const workspaceCounts = await getWorkspaceCounts(session.shop);

  const jobViews: SyncJobView[] = jobs.map((job) => ({
    id: job.id,
    status: job.status,
    objectCount: job.objectCount,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
  }));

  return {
    orderCount,
    lastUpdatedAt: latestOrder?.updatedAt.toISOString() ?? null,
    orderSyncEnabled: process.env.ORDER_SYNC_ENABLED === "true",
    workspaceCounts,
    jobs: jobViews,
    hasActiveJob: jobViews.some(
      (job) => job.status === "queued" || job.status === "running",
    ),
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<SyncResult> => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (process.env.ORDER_SYNC_ENABLED !== "true") {
    return {
      ok: false,
      error:
        "Order sync requires Shopify approval for protected customer data.",
    };
  }

  if (formData.get("intent") !== "sync") {
    return { ok: false, error: "Unknown action." };
  }

  // Submitting a bulk operation is cheap, but rate-limit anyway so a merchant
  // double-clicking "Sync orders now" can't queue up several jobs at once.
  if (await isRateLimited(`order-sync:${session.shop}`, 5, 5 * 60 * 1000)) {
    return {
      ok: false,
      error: "Order sync was run too recently. Please wait a few minutes.",
    };
  }

  // Orders are exported server-side via Shopify's Bulk Operations API and
  // ingested asynchronously when bulk_operations/finish fires — this avoids
  // pulling a store's entire order history through the request/response
  // cycle, which times out well before 7,000+ orders finish paginating.
  const result = await startOrderBulkSync(session.shop, admin);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
};

export default function OrderSync() {
  const {
    orderCount,
    lastUpdatedAt,
    orderSyncEnabled,
    workspaceCounts,
    jobs,
    hasActiveJob,
  } = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<SyncResult>();
  const revalidator = useRevalidator();
  const syncing = syncFetcher.state !== "idle" || hasActiveJob;

  useFetcherToast(syncFetcher, (data) =>
    data.ok
      ? "Order sync started — this can take a few minutes for large stores."
      : (data.error ?? "Order sync failed."),
  );

  // A running job finishes asynchronously (via the bulk_operations/finish
  // webhook), so poll the loader while one is in flight to pick up its
  // status without the merchant having to refresh. The effect re-runs (and
  // clears the previous interval) whenever hasActiveJob flips, so polling
  // stops on its own once the job completes.
  useEffect(() => {
    if (!hasActiveJob) return;
    const interval = setInterval(() => revalidator.revalidate(), 4000);
    return () => clearInterval(interval);
  }, [hasActiveJob, revalidator]);

  const lastUpdated = lastUpdatedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(lastUpdatedAt))
    : "Never";

  return (
    <s-page>
      <PageHeader
        title="Order sync"
        subtitle="Keep the order cache used for claim verification up to date."
        actions={
          <AppButton href="/app" variant="secondary">
            Back to home
          </AppButton>
        }
      />
      <WorkspaceTabs
        active="order-sync"
        counts={{
          orders: workspaceCounts.ordersNeedingAction,
          claims: workspaceCounts.openClaims,
        }}
      />

      <Card heading="Sync status">
        <div className="app-card-row">
          <StatTile
            icon="check-circle"
            label="Sync mode"
            tone="warning"
            value={orderSyncEnabled ? "Manual" : "Approval required"}
          />
          <StatTile
            icon="order"
            label="Cached orders"
            value={String(orderCount)}
          />
          <StatTile
            icon="clock"
            label="Last cache update"
            value={lastUpdated}
          />
        </div>
      </Card>

      <Card heading="Manual synchronization">
        <s-stack gap="base">
          {!orderSyncEnabled ? (
            <s-banner heading="Protected Order access required" tone="warning">
              Shopify is currently blocking this app from accessing orders.
              Request protected customer data access in the Partner Dashboard,
              then set ORDER_SYNC_ENABLED=true and restart the app.
            </s-banner>
          ) : (
            <s-paragraph>
              Import available existing orders now. Runs as a background job
              on Shopify&apos;s side, so it&apos;s safe to use even with tens
              of thousands of orders. Automatic order webhooks remain off, so
              use this button whenever orders change.
            </s-paragraph>
          )}
          {syncFetcher.data && !syncFetcher.data.ok ? (
            <s-banner tone="critical">{syncFetcher.data.error}</s-banner>
          ) : null}
          <syncFetcher.Form method="post">
            <input type="hidden" name="intent" value="sync" />
            <AppButton
              type="submit"
              variant="primary"
              disabled={syncing || !orderSyncEnabled}
            >
              {!orderSyncEnabled
                ? "Order access required"
                : syncing
                  ? "Sync running…"
                  : "Sync orders now"}
            </AppButton>
          </syncFetcher.Form>
        </s-stack>
      </Card>

      <Card heading="Sync jobs">
        {jobs.length === 0 ? (
          <s-paragraph>No sync jobs yet.</s-paragraph>
        ) : (
          <div className="app-job-list">
            {jobs.map((job) => (
              <div className="app-job-row" key={job.id}>
                <span
                  className={`app-job-row__status app-job-row__status--${job.status}`}
                >
                  {SYNC_JOB_STATUS_LABEL[job.status] ?? job.status}
                </span>
                <span className="app-job-row__meta">
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(job.createdAt))}
                </span>
                <span className="app-job-row__count">
                  {job.status === "completed"
                    ? `${job.objectCount ?? 0} orders`
                    : job.status === "failed"
                      ? job.errorMessage ?? "Failed"
                      : "In progress…"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
