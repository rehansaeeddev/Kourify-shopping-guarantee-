import "dotenv/config";
import db from "../app/db.server";

async function main() {
  const shop = "oveelab.myshopify.com";
  const session = await db.session.findUniqueOrThrow({ where: { id: `offline_${shop}` } });

  const res = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": session.accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query { products(first: 5, query: "title:'Shipping Protection'") { nodes { id title vendor variantsCount { count } } } }`,
    }),
  });
  console.log("status:", res.status);
  console.log(JSON.stringify(await res.json(), null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
