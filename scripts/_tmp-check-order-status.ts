import "dotenv/config";
import { unauthenticated } from "../app/shopify.server";

async function main() {
  const shop = "oveelab.myshopify.com";
  const orderGid = "gid://shopify/Order/8549094981818"; // #1020
  const { admin } = await unauthenticated.admin(shop);

  const res = await admin.graphql(
    `#graphql
      query KourifyOrderStatus($id: ID!) {
        order(id: $id) {
          id
          name
          displayFulfillmentStatus
          fulfillments(first: 10) { createdAt updatedAt status }
        }
      }`,
    { variables: { id: orderGid } },
  );
  const body = await res.json();
  console.log(JSON.stringify(body.data ?? (body as any).errors, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
