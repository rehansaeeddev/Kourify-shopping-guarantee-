import db from "../db.server";

export type PlanTier = "unknown" | "standard" | "plus" | "dev";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Cart Transform price-override (`update`) operations only actually apply on
 * Shopify Plus. Verified against a development store: a dev store on a Basic plan
 * reports shopifyPlus:false and the checkout silently ignores the override — so
 * `partnerDevelopment` alone is NOT enough. A dev store must be set to the Plus
 * developer preview to test it.
 */
export function supportsCartTransform(tier: PlanTier | string): boolean {
  return tier === "plus";
}

/**
 * Queries the shop's plan and stores the derived tier on MerchantSettings.
 * shopifyPlus is what actually enables Cart Transform price overrides; a
 * partnerDevelopment store that isn't on Plus is tracked as "dev" (informational,
 * not eligible), and everything else is "standard".
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
      tier = plan.shopifyPlus
        ? "plus"
        : plan.partnerDevelopment
          ? "dev"
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
