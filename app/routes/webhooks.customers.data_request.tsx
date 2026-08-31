import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customerEmail = payload.customer?.email as string | undefined;

  if (customerEmail) {
    const claims = await db.protectionClaim.findMany({
      where: { shop, email: customerEmail },
    });

    // Shopify requires the data be made available to the merchant within
    // 30 days; there is no automated customer-facing export endpoint, so
    // this logs it for the merchant/support team to retrieve on request.
    console.log(
      `Data request for ${customerEmail} on ${shop}: ${claims.length} protection claim(s)`,
      claims,
    );
  }

  return new Response();
};
