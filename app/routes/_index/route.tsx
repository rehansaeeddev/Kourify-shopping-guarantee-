import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// The app has no public marketing splash. An embedded install always arrives
// with a `shop` param, which goes straight to the app; anything else (a raw
// visit to the root) goes to the login form, which owns shop-domain entry.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  throw redirect("/auth/login");
};
