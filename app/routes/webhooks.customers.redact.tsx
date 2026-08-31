import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customerEmail = payload.customer?.email as string | undefined;

  if (customerEmail) {
    await db.protectionClaim.updateMany({
      where: { shop, email: customerEmail },
      data: {
        fullName: "Redacted",
        email: "redacted@example.com",
        details: null,
      },
    });
  }

  return new Response();
};
