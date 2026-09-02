import "dotenv/config";
import { unauthenticated } from "../app/shopify.server";

async function main() {
  const shop = "oveelab.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);
  const res = await admin.graphql(`#graphql
    query { webhookSubscriptions(first: 20) { nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }
  `);
  const body = await res.json();
  console.log(JSON.stringify(body.data ?? (body as any).errors, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
