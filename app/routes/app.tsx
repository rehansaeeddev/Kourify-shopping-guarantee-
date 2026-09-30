import { QueryClientProvider } from "@tanstack/react-query";
import { Outlet, isRouteErrorResponse, useRouteError } from "react-router";

import { ApiError } from "../lib/api";
import { usePrefetchNav } from "../lib/prefetch";
import { queryClient } from "../lib/query-client";
import { ToastProvider } from "../components/Toast";
import { PageBody } from "../components/PageBody";

/**
 * The admin shell.
 *
 * There is no loader here any more. App Bridge and Polaris are loaded by the
 * document itself, and the shop's identity comes from the session token each
 * API call carries — so nothing has to be fetched before the nav can render.
 */
/**
 * Spread rather than written as a prop: App Bridge reads `rel` off the link,
 * but the published v1.0 types for s-link do not declare it.
 */
const HOME_REL = { rel: "home" } as Record<string, string>;

export default function App() {
  // Warms the nav's queries once the page you asked for has painted, so the
  // next click renders from cache instead of showing a loading card.
  usePrefetchNav();

  return (
    <QueryClientProvider client={queryClient}>
      <s-app-nav>
        {/*
          rel="home" is what tells the admin this is the app's landing route.
          Without it /app was registered as an ordinary item, so it sat in the
          sidebar as a second copy of the app-name row above it -- and, being
          the prefix of every other route here, stayed highlighted while the
          page open was Settings or Billing. Marked this way it is hidden from
          the menu and the app name becomes the link to it.
        */}
        <s-link href="/app" {...HOME_REL}>
          Home
        </s-link>
        <s-link href="/app/orders">Orders</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/billing">Billing</s-link>
        <s-link href="/app/guide">Help</s-link>
      </s-app-nav>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </QueryClientProvider>
  );
}

/**
 * Renders inside the admin, so it has to say something useful rather than
 * leave a merchant looking at a blank frame.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  /*
   * A thrown Error says what went wrong; say it.
   *
   * Everything that was not an ApiError or a route response fell through to
   * one sentence that names nothing -- so a render crash and a dropped
   * tunnel produced the same screen, and neither the merchant reporting it
   * nor anyone reading the report could tell them apart.
   */
  const message =
    error instanceof ApiError
      ? error.message
      : isRouteErrorResponse(error)
        ? `${error.status} ${error.statusText}`
        : error instanceof Error && error.message !== ""
          ? error.message
          : "Something went wrong loading this page.";

  // The stack is for whoever is running the app, not for a merchant.
  const stack =
    import.meta.env.DEV && error instanceof Error ? error.stack : undefined;

  return (
    <s-page inlineSize="large" heading="Something went wrong">
      <PageBody>
        <s-section>
          <s-banner tone="critical" heading="This page could not load">
            <s-paragraph>{message}</s-paragraph>
          </s-banner>
          {stack ? (
            <s-text color="subdued">
              {stack.split("\n").slice(0, 6).join(" ")}
            </s-text>
          ) : null}
          <s-stack direction="inline">
            <s-button onClick={() => window.location.reload()}>Reload</s-button>
          </s-stack>
        </s-section>
      </PageBody>
    </s-page>
  );
}
