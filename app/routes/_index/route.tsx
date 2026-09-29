import { redirect } from "react-router";

/**
 * The root has nothing of its own to show.
 *
 * An embedded install always arrives with a `shop` parameter, which goes
 * straight to the app and carries the App Bridge context with it. A raw visit
 * has no such context, and there is no login page to send it to any more —
 * token exchange starts inside the Shopify admin — so it is told where to go
 * instead of being redirected somewhere that would fail to authenticate.
 *
 * A clientLoader, not a loader: this is a single-page build with no server to
 * run one, and the router rejects a route that exports one.
 */
export function clientLoader({ request }: { request: Request }) {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
}

export default function Index() {
  return (
    <s-page inlineSize="large" heading="Kourify">
      <s-section>
        <s-banner heading="Open this app from your Shopify admin">
          <s-paragraph>
            Kourify runs inside the Shopify admin. Open it from Apps in your
            store, or install it from the App Store.
          </s-paragraph>
        </s-banner>
      </s-section>
    </s-page>
  );
}
