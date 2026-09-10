/**
 * Plan entitlements that are safe on the client.
 *
 * Kept out of `plan-limits.server.ts` because the billing page renders the
 * Basic allowance in module-scope constants, which ship to the browser — a
 * `.server` import there fails the build rather than silently leaking.
 *
 * These are *entitlements* (how many orders a plan may protect), entirely
 * separate from coverage eligibility (what an item may be worth).
 */

export type PlanId = "basic" | "usage" | "unlimited" | "unlimited_annual";

/** Orders the free Basic plan may protect before protection switches off. */
export const BASIC_PROTECTED_ORDER_LIMIT = 20;

/** Only Basic is capped; every paid plan protects without a count limit. */
export function planProtectedOrderLimit(plan: PlanId): number | null {
  return plan === "basic" ? BASIC_PROTECTED_ORDER_LIMIT : null;
}

/** Plans with no per-order usage fee. */
export function planWaivesUsageFee(plan: PlanId): boolean {
  return plan === "basic" || plan === "unlimited" || plan === "unlimited_annual";
}

/**
 * Can this plan charge the customer for protection?
 *
 * No, on any plan with a protected-order allowance. The charge happens inside
 * Shopify checkout, and Shopify gives an app no hook between "customer submits
 * payment" and "charge completes" — checkout UI extensions render, they don't
 * veto. So the backend cannot guarantee, at the moment of charging, that a
 * slot will still be free when the webhook arrives.
 *
 * Rather than take money we might not be able to honour, a capped plan is
 * merchant-pays only. Merchant-pays coverage costs the shopper nothing, so
 * refusing it at the limit harms no one.
 */
export function planAllowsCustomerPays(plan: PlanId): boolean {
  return planProtectedOrderLimit(plan) === null;
}
