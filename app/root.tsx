import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import "./styles/theme.css";

/**
 * The client ID is a public identifier — it is in shopify.app.toml and every
 * embedded app sends it to the browser. The secret never leaves the backend.
 */
const SHOPIFY_API_KEY = import.meta.env.VITE_SHOPIFY_API_KEY as string;

/**
 * The document.
 *
 * Exported as `Layout`, not returned from the default export: in SPA mode the
 * shell is prerendered at build time, and React Router only uses the root's
 * `Layout` for it. Without one it falls back to a document of its own — which
 * silently dropped both CDN scripts below, so App Bridge never minted a
 * session token and the s-* elements stayed plain text.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        {/*
          Both load from Shopify's CDN, not from npm. app-bridge.js is what
          mints the session tokens this app authenticates with, and the Polaris
          script is what defines the s-* elements every page is built from —
          neither has an npm package, and @shopify/polaris (the React library)
          must never be imported alongside them.

          Polaris 2, not `polaris.js`. Shopify has given the admin a new frame,
          navigation and visual appearance, and "Polaris 1 doesn't contain the
          updated styling at all, so an app that loads Polaris 1 renders the
          current appearance regardless of what the Shopify admin around it is
          doing" — which is exactly what the app looked like: old-style cards
          washed out against a refreshed admin. Polaris 2 ships both
          appearances and picks one at runtime from what App Bridge reports, so
          this is the whole change; no page needed restyling.
          https://shopify.dev/docs/apps/build/app-home/polaris2

          It is a release candidate. Shopify's own advice is to run on it now
          and move to the stable build when one is promoted, so this pin is
          meant to be revisited rather than left alone.
        */}
        <script
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          data-api-key={SHOPIFY_API_KEY}
        />
        <script src="https://cdn.shopify.com/shopifycloud/polaris-2.0-rc.js" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
