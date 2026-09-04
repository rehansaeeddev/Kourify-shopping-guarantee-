import db from "../db.server";

export type PlanTier = "unknown" | "standard" | "plus" | "dev";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/** Cart Transform price overrides only run on dev + Plus stores. */
export function supportsCartTransform(tier: PlanTier | string): boolean {
  return tier === "plus" || tier === "dev";
}

/**
 * Queries the shop's plan and stores the derived tier on MerchantSettings.
 * `partnerDevelopment` (a dev store) and `shopifyPlus` both allow Cart Transform
 * price overrides; everything else is treated as standard.
 */
export async function detectPlanTier(
  admin: AdminGraphqlClient,
  shop: string,
): Promise<PlanTier> {
  let tier: PlanTier = "unknown";
  try {
    const response = await admin.graphql(
      `#graphql
        query ShopPlanTier {
          shop {
            plan {
              publicDisplayName
              partnerDevelopment
              shopifyPlus
            }
          }
        }`,
    );
    const json = await response.json();
    const plan = json?.data?.shop?.plan;
    if (plan) {
      tier = plan.partnerDevelopment
        ? "dev"
        : plan.shopifyPlus
          ? "plus"
          : "standard";
    }
  } catch (error) {
    console.error("[plan-tier] failed to detect shop plan", error);
    return "unknown";
  }

  await db.merchantSettings
    .update({ where: { shop }, data: { planTier: tier } })
    .catch(() => null);
  return tier;
}
