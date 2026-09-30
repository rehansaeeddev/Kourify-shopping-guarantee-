import { QueryClientProvider } from "@tanstack/react-query";
import { Outlet, isRouteErrorResponse, useRouteError } from "react-router";

import { ApiError } from "../lib/api";
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
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
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

  const message =
    error instanceof ApiError
      ? error.message
      : isRouteErrorResponse(error)
        ? `${error.status} ${error.statusText}`
        : "Something went wrong loading this page.";

  return (
    <s-page inlineSize="large" heading="Something went wrong">
      <PageBody>
        <s-section>
          <s-banner tone="critical" heading="This page could not load">
            <s-paragraph>{message}</s-paragraph>
          </s-banner>
          <s-stack direction="inline">
            <s-button onClick={() => window.location.reload()}>Reload</s-button>
          </s-stack>
        </s-section>
      </PageBody>
    </s-page>
  );
}
