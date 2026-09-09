import db from "../db.server";

type AdminGraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type ProtectionTelemetry = {
  avgResolutionHours: number | null;
  incidentRate: number | null;
};

/**
 * Command Center KPIs: average time to resolve a claim, and claims filed as
 * a percentage of fulfilled orders. The fulfilled-orders count comes from a
 * live Admin API call and has not been exercised against a real store from
 * here — it degrades to `incidentRate: null` if the query fails rather than
 * breaking the dashboard.
 */
export async function getProtectionTelemetry(
  shop: string,
  admin: AdminGraphqlClient,
): Promise<ProtectionTelemetry> {
  const claimsForTelemetry = await db.protectionClaim.findMany({
    where: { shop },
    select: { createdAt: true, resolvedAt: true },
  });

  const resolvedWithTimes = claimsForTelemetry.filter((c) => c.resolvedAt);
  const avgResolutionHours = resolvedWithTimes.length
    ? resolvedWithTimes.reduce(
        (sum, c) => sum + (c.resolvedAt!.getTime() - c.createdAt.getTime()),
        0,
      ) /
      resolvedWithTimes.length /
      (1000 * 60 * 60)
    : null;

  let fulfilledOrdersCount: number | null = null;
  try {
    const res = await admin.graphql(
      `#graphql
        query kourifyFulfilledOrdersCount {
          ordersCount(query: "fulfillment_status:fulfilled") {
            count
          }
        }`,
    );
    const json = await res.json();
    fulfilledOrdersCount = json?.data?.ordersCount?.count ?? null;
  } catch {
    fulfilledOrdersCount = null;
  }

  const incidentRate =
    fulfilledOrdersCount && fulfilledOrdersCount > 0
      ? (claimsForTelemetry.length / fulfilledOrdersCount) * 100
      : null;

  return { avgResolutionHours, incidentRate };
}

export type ClaimsTrend = {
  /** One count per day, oldest first, for the last 14 days. */
  dailyCounts: number[];
  last7Count: number;
  /** The 7 days before that — the baseline `last7Count` is compared against. */
  previous7Count: number;
};

/**
 * A lightweight trend for the dashboard sparkline: claims filed per day over
 * the last 14 days, bucketed in JS rather than a DB-specific date-trunc query
 * (Prisma/MySQL) — the claim volume this app deals with is small enough that
 * this is cheap, and it keeps the query portable.
 */
export async function getClaimsTrend(shop: string): Promise<ClaimsTrend> {
  const since = new Date();
  since.setDate(since.getDate() - 14);
  since.setHours(0, 0, 0, 0);

  const claims = await db.protectionClaim.findMany({
    where: { shop, createdAt: { gte: since } },
    select: { createdAt: true },
  });

  const dailyCounts = Array.from({ length: 14 }, () => 0);
  const now = Date.now();
  for (const claim of claims) {
    const daysAgo = Math.floor(
      (now - claim.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    const index = 13 - daysAgo;
    if (index >= 0 && index < 14) dailyCounts[index]!++;
  }

  const last7Count = dailyCounts.slice(7).reduce((a, b) => a + b, 0);
  const previous7Count = dailyCounts.slice(0, 7).reduce((a, b) => a + b, 0);

  return { dailyCounts, last7Count, previous7Count };
}
