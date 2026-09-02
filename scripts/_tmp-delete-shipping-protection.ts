import "dotenv/config";
import { unauthenticated } from "../app/shopify.server";

async function main() {
  const shop = "oveelab.myshopify.com";
  const { admin } = await unauthenticated.admin(shop);

  const findRes = await admin.graphql(`#graphql
    query {
      products(first: 5, query: "title:'Shipping Protection'") {
        nodes { id title vendor variantsCount { count } }
      }
    }
  `);
  const findBody = await findRes.json();
  console.log("found:", JSON.stringify(findBody.data ?? (findBody as any).errors, null, 2));

  const product = findBody.data?.products?.nodes?.[0];
  if (!product) {
    console.log("No matching product found, aborting.");
    return;
  }

  const delRes = await admin.graphql(
    `#graphql
      mutation KourifyDeleteProduct($input: ProductDeleteInput!) {
        productDelete(input: $input) {
          deletedProductId
          userErrors { field message }
        }
      }`,
    { variables: { input: { id: product.id } } },
  );
  const delBody = await delRes.json();
  console.log("delete result:", JSON.stringify(delBody.data ?? (delBody as any).errors, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
