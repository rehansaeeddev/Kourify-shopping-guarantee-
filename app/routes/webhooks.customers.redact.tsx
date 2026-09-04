import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const rawEmail = payload.customer?.email as string | undefined;
  // Claims store a normalized (lower-cased, trimmed) email; the webhook payload
  // is not normalized, so match on the same normalized form or a case-different
  // address (e.g. "John@X.com") would match nothing and leave PII in place.
  const customerEmail = rawEmail?.trim().toLowerCase();

  if (customerEmail) {
    await db.$transaction([
      db.protectionClaim.updateMany({
        where: { shop, email: customerEmail },
        data: {
          fullName: "Redacted",
          email: "redacted@example.com",
          details: null,
        },
      }),
      // The Order cache also holds this customer's email/name — scrub it too.
      db.order.updateMany({
        where: { shop, email: customerEmail },
        data: { email: "redacted@example.com", customerName: null },
      }),
    ]);
  }

  return new Response();
};
