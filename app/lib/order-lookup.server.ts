import { riskLevelFromRecommendation } from "./order-risk";

type AdminGraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type VerifiedOrder = {
  id: string;
  name: string;
  shippedAt: string | null;
};

/**
 * Looks up a real order by the number the customer typed in, and finds the
 * most recent fulfillment date to validate claim-filing windows against.
 * Returns null if no matching order exists — the caller should treat that
 * as "we could not verify this order" rather than silently trusting the
 * customer-entered order number.
 */
export async function findOrderByNumber(
  admin: AdminGraphqlClient,
  orderNumber: string,
): Promise<VerifiedOrder | null> {
  const normalized = orderNumber.trim().replace(/^#/, "");
  if (!normalized) return null;

  const response = await admin.graphql(
    `#graphql
      query kourifyFindOrder($query: String!) {
        orders(first: 1, query: $query) {
          edges {
            node {
              id
              name
              fulfillments(first: 10) {
                createdAt
              }
            }
          }
        }
      }`,
    { variables: { query: `name:${normalized} OR name:#${normalized}` } },
  );

  const json = await response.json();
  const edge = json?.data?.orders?.edges?.[0];
  if (!edge) return null;

  const fulfillments = edge.node.fulfillments ?? [];
  const shippedAt =
    fulfillments.length > 0
      ? fulfillments
          .map((f: { createdAt: string }) => f.createdAt)
          .sort()
          .slice(-1)[0]
      : null;

  return { id: edge.node.id, name: edge.node.name, shippedAt };
}

/**
 * Best-effort order risk lookup. Shopify's risk-assessment GraphQL field has
 * changed across API versions — this is written defensively so an
 * unexpected schema shape degrades to `null` instead of breaking claim
 * submission. Verify this against a real order on your API version.
 */
export async function findOrderRiskLevel(
  admin: AdminGraphqlClient,
  orderId: string,
): Promise<string | null> {
  try {
    const response = await admin.graphql(
      `#graphql
        query kourifyOrderRisk($id: ID!) {
          order(id: $id) {
            risk {
              recommendation
            }
          }
        }`,
      { variables: { id: orderId } },
    );
    const json = await response.json();
    if (json?.errors) return null;
    return riskLevelFromRecommendation(
      json?.data?.order?.risk?.recommendation,
    );
  } catch {
    return null;
  }
}
