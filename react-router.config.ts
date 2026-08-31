import type { Config } from "@react-router/dev/config";

export default {
  // React Router's built-in action CSRF check compares the request's `Origin`
  // header against the host in `request.url`. Behind the Cloudflare/ngrok dev
  // tunnel and Shopify's embedded admin iframe, the browser's `Origin` is the
  // tunnel/admin host while the server sees an internal host, so they never
  // match without this allowlist.
  allowedActionOrigins: ["admin.shopify.com", "*.myshopify.com", "*.trycloudflare.com"],
} satisfies Config;
