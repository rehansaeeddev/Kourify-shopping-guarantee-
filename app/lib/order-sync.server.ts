import db from "../db.server";
import { riskLevelFromRecommendation } from "./order-risk";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown>; signal?: AbortSignal },
  ) => Promise<Response>;
};

const GRAPHQL_TIMEOUT_MS = 10_000;

export type CachedOrder = {
  id: string;
  name: string;
  email: string;
  customerName?: string | null;
  status: string;
  riskLevel: string | null;
  shippedAt: string | null;
};

/**
 * Saves an order to the database cache.
 * Called by order/created and orders/updated webhooks.
 */
export async function cacheOrder(
  shop: string,
  data: {
    id: string;
    name: string;
    email: string;
    customerName?: string | null;
    status: string;
    riskLevel: string | null;
    shippedAt: string | null;
    totalPrice?: string | null;
  },
): Promise<void> {
  await db.order.upsert({
    where: { id: data.id },
    // On update, don't let a webhook that omits a value wipe a richer one we
    // already cached: orders/updated carries riskLevel: null and (when there
    // are no fulfillments) shippedAt: null, and can carry an empty email. Only
    // overwrite those fields when the incoming value is actually present.
    update: {
      ...(data.email ? { email: data.email } : {}),
      customerName: data.customerName ?? null,
      status: data.status,
      ...(data.riskLevel != null ? { riskLevel: data.riskLevel } : {}),
      ...(data.shippedAt ? { shippedAt: new Date(data.shippedAt) } : {}),
      totalPrice: data.totalPrice ?? null,
      updatedAt: new Date(),
    },
    create: {
      id: data.id,
      shop,
      name: data.name,
      email: data.email,
      customerName: data.customerName ?? null,
      status: data.status,
      riskLevel: data.riskLevel,
      shippedAt: data.shippedAt ? new Date(data.shippedAt) : null,
      totalPrice: data.totalPrice ?? null,
    },
  });
}

/**
 * Looks up an order from cache first. If not found, queries Shopify API.
 * Used by claim submission to avoid repeated API calls for the same order.
 */
export async function findOrderByNumberWithCache(
  admin: AdminGraphqlClient,
  shop: string,
  orderNumber: string,
): Promise<CachedOrder | null> {
  const normalized = orderNumber.trim().replace(/^#/, "");
  if (!normalized) return null;

  // Check cache first
  const cached = await db.order.findFirst({
    where: {
      shop,
      name: {
        in: [normalized, `#${normalized}`],
      },
    },
  });

  if (cached) {
    return {
      id: cached.id,
      name: cached.name,
      email: cached.email,
      status: cached.status,
      riskLevel: cached.riskLevel,
      shippedAt: cached.shippedAt?.toISOString() ?? null,
    };
  }

  // Cache miss — fetch from Shopify API and cache it
  const response = await admin.graphql(
    `#graphql
      query kourifyFindOrder($query: String!) {
        orders(first: 1, query: $query) {
          edges {
            node {
              id
              name
              email
              fulfillments(first: 10) { createdAt }
              risk { recommendation }
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }`,
    {
      variables: { query: `name:${normalized} OR name:#${normalized}` },
      signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
    },
  );

  const json = await response.json();
  const edge = json?.data?.orders?.edges?.[0];
  if (!edge) return null;

  const node = edge.node;
  const fulfillments = node.fulfillments ?? [];
  const shippedAt =
    fulfillments
      .map(
        (fulfillment: { createdAt?: string | null }) => fulfillment.createdAt,
      )
      .filter((createdAt: string | null | undefined): createdAt is string =>
        Boolean(createdAt),
      )
      .sort()
      .at(-1) ?? null;

  const order: CachedOrder = {
    id: node.id,
    name: node.name,
    email: node.email ?? "",
    customerName: null,
    status: fulfillments.length > 0 ? "fulfilled" : "pending",
    riskLevel: riskLevelFromRecommendation(node.risk?.recommendation),
    shippedAt,
  };

  // Cache it for future lookups
  await cacheOrder(shop, {
    id: order.id,
    name: order.name,
    email: order.email,
    customerName: null,
    status: order.status,
    riskLevel: order.riskLevel,
    shippedAt: order.shippedAt,
    totalPrice: node.totalPriceSet?.shopMoney?.amount,
  });

  return order;
}

/**
 * Deletes an order from cache (called on orders/delete webhook).
 */
export async function deleteOrderFromCache(orderId: string): Promise<void> {
  await db.order.delete({ where: { id: orderId } }).catch(() => null);
}
