import {
  authenticate,
  USAGE_PLAN,
  UNLIMITED_PLAN,
  UNLIMITED_ANNUAL_PLAN,
} from "../shopify.server";
import type { PlanId } from "./plans";

type Billing = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

export type { PlanId } from "./plans";

export type BillingState = {
  /** True only for a real paid subscription. Basic is free, so this is false. */
  hasActiveBilling: boolean;
  activePlan: PlanId;
  /** Needed to cancel the paid plan when downgrading back to Basic. */
  activeSubscriptionId: string | null;
};

const PLAN_BY_NAME: Record<string, PlanId> = {
  [USAGE_PLAN]: "usage",
  [UNLIMITED_PLAN]: "unlimited",
  [UNLIMITED_ANNUAL_PLAN]: "unlimited_annual",
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
    plans: [USAGE_PLAN, UNLIMITED_PLAN, UNLIMITED_ANNUAL_PLAN],
    isTest,
  });
  const active = state.appSubscriptions[0];
  const activePlan = PLAN_BY_NAME[active?.name ?? ""] ?? "basic";
  return {
    hasActiveBilling: state.hasActivePayment,
    activePlan,
    activeSubscriptionId: active?.id ?? null,
  };
}
