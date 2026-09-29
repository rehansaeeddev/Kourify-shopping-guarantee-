import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import "./styles/theme.css";

/**
 * The client ID is a public identifier — it is in shopify.app.toml and every
 * embedded app sends it to the browser. The secret never leaves the backend.
 */
const SHOPIFY_API_KEY = import.meta.env.VITE_SHOPIFY_API_KEY as string;

export default function App() {
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
          mints the session tokens this app authenticates with, and polaris.js
          is what defines the s-* elements every page is built from — neither
          has an npm package, and @shopify/polaris (the React library) must
          never be imported alongside them.
        */}
        <script
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          data-api-key={SHOPIFY_API_KEY}
        />
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
