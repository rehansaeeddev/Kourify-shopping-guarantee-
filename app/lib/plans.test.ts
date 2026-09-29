import { describe, expect, it } from "vitest";

import {
  BASIC_PROTECTED_ORDER_LIMIT,
  planAllowsCustomerPays,
  planProtectedOrderLimit,
  planWaivesUsageFee,
  type PlanId,
} from "./plans";

const PLANS: PlanId[] = ["basic", "usage", "unlimited", "unlimited_annual"];

describe("plan entitlements", () => {
  it("caps only Basic", () => {
    expect(planProtectedOrderLimit("basic")).toBe(BASIC_PROTECTED_ORDER_LIMIT);

    for (const plan of PLANS.filter((p) => p !== "basic")) {
      expect(planProtectedOrderLimit(plan)).toBeNull();
    }
  });

  it("charges the per-order usage fee on Usage alone", () => {
    expect(planWaivesUsageFee("usage")).toBe(false);

    for (const plan of PLANS.filter((p) => p !== "usage")) {
      expect(planWaivesUsageFee(plan)).toBe(true);
    }
  });

  /**
   * A capped plan cannot charge the shopper: Shopify gives an app no hook
   * between "customer pays" and "charge completes", so the backend cannot
   * promise a slot will still be free when the webhook lands. Taking money it
   * might not be able to honour is the failure this rules out.
   */
  it("ties customer-pays to having no allowance", () => {
    for (const plan of PLANS) {
      expect(planAllowsCustomerPays(plan)).toBe(
        planProtectedOrderLimit(plan) === null,
      );
    }

    expect(planAllowsCustomerPays("basic")).toBe(false);
  });
});
