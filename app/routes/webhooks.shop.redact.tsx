import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // GDPR: shop/redact fires ~48h after uninstall and requires erasing every
  // piece of the shop's data we still hold — not just claims/settings. Purge
  // all shop-scoped tables, including the customer PII cached on Order
  // (email, customerName) and everything the uninstall handler removes.
  await db.$transaction([
    db.usageEvent.deleteMany({ where: { shop } }),
    db.protectedOrder.deleteMany({ where: { shop } }),
    db.protectionOffer.deleteMany({ where: { shop } }),
    db.protectionClaim.deleteMany({ where: { shop } }),
    db.order.deleteMany({ where: { shop } }),
    db.auditLog.deleteMany({ where: { shop } }),
    db.storefrontTranslation.deleteMany({ where: { shop } }),
    db.merchantConsent.deleteMany({ where: { shop } }),
    db.merchantSettings.deleteMany({ where: { shop } }),
  ]);

  return new Response();
};
