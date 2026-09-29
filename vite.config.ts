import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

/*
 * `shopify app dev` injects the app's client id as SHOPIFY_API_KEY, but only
 * VITE_-prefixed variables reach the browser bundle — and root.tsx needs this
 * one to start App Bridge. Mirrored rather than hardcoded, so the key always
 * belongs to whichever app the CLI is actually running.
 */
if (process.env.SHOPIFY_API_KEY) {
  process.env.VITE_SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

/**
 * Where the Laravel backend is listening in development.
 *
 * The Shopify CLI tunnels to this dev server, so every path the backend owns
 * has to be forwarded from here: webhook deliveries, App Proxy requests from
 * the storefront, and the admin's own API calls. In production the same three
 * are same-origin because Laravel serves the built SPA itself — which is what
 * lets the API client use relative paths in both places.
 */
/**
 * Says who may frame the dev server.
 *
 * A browser refuses to frame an embedded app that does not name its allowed
 * ancestors, and the refusal renders as an empty broken frame inside the
 * Shopify admin rather than an error anyone can read. In production Laravel
 * sends this header (AdminAppController); during `shopify app dev` Vite serves
 * the document instead, and Vite sends no CSP of its own.
 */
function frameAncestors(): Plugin {
  return {
    name: "kourify:frame-ancestors",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const shop = new URL(
          req.url ?? "/",
          "http://localhost",
        ).searchParams.get("shop");

        // Same normalising as the backend: Shopify sends either spelling.
        const domain =
          shop && /^[a-z0-9][a-z0-9-]*(\.myshopify\.com)?$/i.test(shop)
            ? shop.endsWith(".myshopify.com")
              ? shop
              : `${shop}.myshopify.com`
            : null;

        res.setHeader(
          "Content-Security-Policy",
          domain
            ? `frame-ancestors https://${domain} https://admin.shopify.com;`
            : // No shop on this request — a wildcard rather than 'none', so a
              // reload without the parameter does not render as a broken frame.
              "frame-ancestors https://*.myshopify.com https://admin.shopify.com;",
        );

        next();
      });
    },
  };
}

const BACKEND = process.env.KOURIFY_BACKEND_URL || "http://127.0.0.1:8000";
const BACKEND_PATHS = ["/api", "/webhooks", "/proxy"];

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
    proxy: Object.fromEntries(
      BACKEND_PATHS.map((path) => [
        path,
        // changeOrigin stays off: the backend verifies Shopify's HMAC and the
        // App Proxy signature against the request as it arrived, and rewriting
        // the Host header is exactly the kind of edit that breaks one.
        { target: BACKEND, changeOrigin: false },
      ]),
    ),
  },
  plugins: [frameAncestors(), reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
}) satisfies UserConfig;
