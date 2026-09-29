import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
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
  plugins: [reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
}) satisfies UserConfig;
