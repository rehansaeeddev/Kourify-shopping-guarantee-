import "dotenv/config";
import { unauthenticated } from "../app/shopify.server";

const APP_URL = "https://medication-undergraduate-fisheries-pub.trycloudflare.com";

const TOPICS: { topic: string; path: string }[] = [
  { topic: "ORDERS_CREATE", path: "/webhooks/orders/create" },
  { topic: "ORDERS_UPDATED", path: "/webhooks/orders/updated" },
];

async function main() {
  const shop = "oveelab.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  // Delete stale subscriptions pointing at dead tunnels
  const existing = await admin.graphql(`#graphql
    query { webhookSubscriptions(first: 20) { nodes { id topic } } }
  `);
  const existingBody = await existing.json();
  for (const node of existingBody.data.webhookSubscriptions.nodes as { id: string; topic: string }[]) {
    const res = await admin.graphql(
      `#graphql
        mutation KourifyDeleteWebhook($id: ID!) {
          webhookSubscriptionDelete(id: $id) { userErrors { field message } }
        }`,
      { variables: { id: node.id } },
    );
    console.log("deleted", node.topic, JSON.stringify(await res.json()));
  }

  for (const { topic, path } of TOPICS) {
    const res = await admin.graphql(
      `#graphql
        mutation KourifyRegisterWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
            webhookSubscription { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          topic,
          webhookSubscription: { callbackUrl: `${APP_URL}${path}`, format: "JSON" },
        },
      },
    );
    const body = await res.json();
    console.log(topic, JSON.stringify(body.data ?? (body as any).errors, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
