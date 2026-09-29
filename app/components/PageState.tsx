import { ApiError } from "../lib/api";
import { PageBody } from "./PageBody";

/**
 * What a page shows while its data is in flight.
 *
 * The heading is rendered immediately so the admin frame and its title are
 * there from the first paint — a page that appears entirely blank while
 * loading reads as broken, which is exactly what a spinner is meant to avoid.
 */
export function PageSkeleton({ heading }: { heading: string }) {
  return (
    <s-page inlineSize="large" heading={heading}>
      <PageBody>
        <s-section>
          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-spinner accessibilityLabel="Loading" />
            <s-text color="subdued">Loading…</s-text>
          </s-stack>
        </s-section>
      </PageBody>
    </s-page>
  );
}

/**
 * What a page shows when its data could not be fetched.
 *
 * Says what went wrong and offers the one action that might fix it. A merchant
 * who hit a rate limit or a momentary network failure should be able to retry
 * without reloading the whole embedded frame and losing their place.
 */
export function PageError({
  heading,
  error,
  onRetry,
}: {
  heading: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : "Something went wrong loading this page.";

  return (
    <s-page inlineSize="large" heading={heading}>
      <PageBody>
        <s-section>
          <s-banner tone="critical" heading="This page could not load">
            <s-paragraph>{message}</s-paragraph>
          </s-banner>
          {onRetry ? (
            <s-stack direction="inline">
              <s-button onClick={onRetry}>Try again</s-button>
            </s-stack>
          ) : null}
        </s-section>
      </PageBody>
    </s-page>
  );
}
