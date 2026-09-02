import "dotenv/config";
import shopify from "../app/shopify.server";

console.log(Object.keys(shopify));
console.log("api present:", "api" in shopify, typeof (shopify as any).api);
