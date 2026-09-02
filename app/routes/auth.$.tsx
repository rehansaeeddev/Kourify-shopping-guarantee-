
import { redirect, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const requestUrl = new URL(request.url);
  const idToken = requestUrl.searchParams.get("id_token");
  const reloadUrl = requestUrl.searchParams.get("shopify-reload");

  // Complete Shopify's session-token bounce after App Bridge has appended a
  // signed token. The package bootstrap currently renders again at this point
  // in Chrome, leaving a blank iframe. Only forward to our own configured
  // origin; authenticate.admin validates the token on the destination request.
  if (requestUrl.pathname.endsWith("/session-token") && idToken && reloadUrl) {
    const destination = new URL(reloadUrl);
    const configuredOrigin = new URL(
      process.env.SHOPIFY_APP_URL || requestUrl.origin,
    ).origin;
    if (destination.origin === configuredOrigin) {
      destination.searchParams.set("id_token", idToken);
      throw redirect(destination.toString());
    }
  }

  await authenticate.admin(request);

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
