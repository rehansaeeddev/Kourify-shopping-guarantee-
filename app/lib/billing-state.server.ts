import { authenticate, USAGE_PLAN, UNLIMITED_PLAN } from "../shopify.server";

type Billing = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

export type BillingState = {
  hasActiveBilling: boolean;
  activePlan: "usage" | "unlimited" | null;
};

/**
 * Test-mode billing must NEVER be reachable in production: if it were, every
 * `billing.check`/`billing.request` would pass without a real charge, letting
 * merchants enable protection for free. Gate the env flag on a non-production
 * NODE_ENV so a misconfigured production deploy always fails closed to real
 * (paid) billing.
 */
export function isBillingTest(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.SHOPIFY_BILLING_TEST === "true"
  );
}

export async function getBillingState(
  billing: Billing,
  isTest = isBillingTest(),
): Promise<BillingState> {
  const state = await billing.check({
    plans: [USAGE_PLAN, UNLIMITED_PLAN],
    isTest,
  });
  const activeName = state.appSubscriptions[0]?.name;
  const activePlan =
    activeName === UNLIMITED_PLAN ? "unlimited" : activeName === USAGE_PLAN ? "usage" : null;
  return { hasActiveBilling: state.hasActivePayment, activePlan };
}
