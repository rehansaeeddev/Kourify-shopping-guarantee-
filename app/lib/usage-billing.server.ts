import db from "../db.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function billUsageEvent(
  eventId: string,
  admin: AdminGraphqlClient,
) {
  const event = await db.usageEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "pending" || event.amountCents <= 0) return;

  try {
    const subscriptionResponse = await admin.graphql(`#graphql
      query KourifyUsageSubscription {
        currentAppInstallation {
          activeSubscriptions {
            name
            lineItems {
              id
              plan { pricingDetails { ... on AppUsagePricing { terms } } }
            }
          }
        }
      }
    `);
    const subscriptionBody = await subscriptionResponse.json();
    const subscriptions = subscriptionBody.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const usageLine = subscriptions
      .find((subscription: { name: string }) => subscription.name === "Kourify Usage")
      ?.lineItems.find(
        (line: { plan?: { pricingDetails?: { terms?: string } } }) =>
          Boolean(line.plan?.pricingDetails?.terms),
      );
    if (!usageLine) return;

    const response = await admin.graphql(
      `#graphql
        mutation KourifyCreateUsageCharge(
          $description: String!
          $price: MoneyInput!
          $subscriptionLineItemId: ID!
          $idempotencyKey: String
        ) {
          appUsageRecordCreate(
            description: $description
            price: $price
            subscriptionLineItemId: $subscriptionLineItemId
            idempotencyKey: $idempotencyKey
          ) {
            appUsageRecord { id }
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          description: "Kourify protected order",
          price: { amount: event.amountCents / 100, currencyCode: "USD" },
          subscriptionLineItemId: usageLine.id,
          idempotencyKey: event.id,
        },
      },
    );
    const body = await response.json();
    const result = body.data?.appUsageRecordCreate;
    if (body.errors?.length || result?.userErrors?.length || !result?.appUsageRecord?.id) {
      throw new Error(
        body.errors?.[0]?.message ?? result?.userErrors?.[0]?.message ?? "Usage charge failed",
      );
    }

    await db.usageEvent.update({
      where: { id: event.id },
      data: { status: "billed", shopifyUsageId: result.appUsageRecord.id },
    });
  } catch (error) {
    console.error(`[kourify] Failed to bill usage event ${event.id}`, error);
    // Keep it pending so a later webhook or billing reconciliation job can retry.
  }
}
