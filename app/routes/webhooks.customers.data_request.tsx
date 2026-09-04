import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const rawEmail = payload.customer?.email as string | undefined;
  // Claims store a normalized (lower-cased, trimmed) email; match the same form
  // so a case-different payload address still finds the customer's records.
  const customerEmail = rawEmail?.trim().toLowerCase();

  if (customerEmail) {
    const claims = await db.protectionClaim.findMany({
      where: { shop, email: customerEmail },
    });

    // Shopify requires the data be made available to the merchant within
    // 30 days; there is no automated customer-facing export endpoint, so
    // support retrieves it from the DB on request. Log only counts/ids — never
    // the records themselves, or a data request would spill the very PII it
    // exists to protect into application logs.
    console.log(
      `Data request on ${shop}: ${claims.length} protection claim(s) [ids: ${claims
        .map((claim) => claim.id)
        .join(", ")}]`,
    );
  }

  return new Response();
};
