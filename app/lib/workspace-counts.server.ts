import db from "../db.server";

export type WorkspaceCounts = {
  /** Claims still needing a decision (submitted or reviewing). */
  openClaims: number;
  /** Protected, paid orders that haven't been fulfilled yet. */
  ordersNeedingAction: number;
};

// Statuses that mean an order needs no fulfilment action.
const RESOLVED_ORDER_STATUSES = ["fulfilled", "cancelled", "canceled", "refunded"];

/**
 * Counts for the notification badges on the Orders / Claims workspace tabs.
 * Always scoped to the authenticated shop by the caller passing session.shop.
 */
export async function getWorkspaceCounts(shop: string): Promise<WorkspaceCounts> {
  const [openClaims, protectedOrders] = await Promise.all([
    db.protectionClaim.count({
      where: { shop, status: { in: ["submitted", "reviewing"] } },
    }),
    db.protectedOrder.findMany({
      where: { shop },
      select: { shopifyOrderId: true },
    }),
  ]);

  const ids = protectedOrders.map((order) => order.shopifyOrderId);
  const ordersNeedingAction = ids.length
    ? await db.order.count({
        where: {
          shop,
          id: { in: ids },
          status: { notIn: RESOLVED_ORDER_STATUSES },
        },
      })
    : 0;

  return { openClaims, ordersNeedingAction };
}
