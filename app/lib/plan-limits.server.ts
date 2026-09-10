import db from "../db.server";
import { planProtectedOrderLimit, type PlanId } from "./plans";

export type ProtectionQuota = {
  limit: number | null;
  used: number;
  remaining: number | null;
  exhausted: boolean;
  /**
   * Past the allowance. Reachable because protection a customer already paid
   * for is always honoured — see recordProtectionSelection. Bounded by how
   * many carts held protection when the allowance ran out.
   */
  overAllowance: boolean;
};

/**
 * How much of a plan's protected-order allowance is spent.
 *
 * Revoked orders don't count — a refunded or cancelled order gave the merchant
 * nothing, so holding a slot for it would penalise them for a reversal they
 * didn't cause.
 */
export async function getProtectionQuota(
  shop: string,
  plan: PlanId,
): Promise<ProtectionQuota> {
  const limit = planProtectedOrderLimit(plan);
  if (limit === null) {
    return {
      limit: null,
      used: 0,
      remaining: null,
      exhausted: false,
      overAllowance: false,
    };
  }

  const used = await db.protectedOrder.count({
    where: { shop, revokedAt: null },
  });

  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    exhausted: used >= limit,
    overAllowance: used > limit,
  };
}
