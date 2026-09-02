import { authenticate, USAGE_PLAN, UNLIMITED_PLAN } from "../shopify.server";

type Billing = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

export type BillingState = {
  hasActiveBilling: boolean;
  activePlan: "usage" | "unlimited" | null;
};

export async function getBillingState(
  billing: Billing,
  isTest = process.env.SHOPIFY_BILLING_TEST === "true",
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
