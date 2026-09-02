import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.$transaction([
      db.usageEvent.deleteMany({ where: { shop } }),
      db.protectedOrder.deleteMany({ where: { shop } }),
      db.protectionClaim.deleteMany({ where: { shop } }),
      db.order.deleteMany({ where: { shop } }),
      db.auditLog.deleteMany({ where: { shop } }),
      db.merchantConsent.deleteMany({ where: { shop } }),
      db.merchantSettings.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
    ]);
  }

  return new Response();
};
