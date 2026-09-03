import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // In development, `shopify app dev` uninstalls/reinstalls the app frequently
  // (every `--reset`, app reinstall, or store re-auth), and each one fires this
  // webhook. Purging here would wipe all local test data (orders, protected
  // orders, claims) on every cycle. Only delete for real production uninstalls,
  // where removing the merchant's data is required.
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[webhooks/app/uninstalled] Skipping data purge for ${shop} (NODE_ENV=${process.env.NODE_ENV ?? "undefined"})`,
    );
    return new Response();
  }

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
