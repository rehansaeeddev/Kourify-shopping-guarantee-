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
