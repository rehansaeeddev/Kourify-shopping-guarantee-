import { ApiError } from "../lib/api";
import { Card } from "./Card";
import { usePageLoading } from "../lib/loading";
import { PageBody } from "./PageBody";

/**
 * What a page shows while its data is in flight.
 *
 * Nothing but its heading. The spinner and "Loading…" that used to sit in a
 * section here have moved to the admin's own header indicator, driven by
 * usePageLoading -- the place the admin already reports this, and one that
 * does not push a box onto the page only to take it away again.
 *
 * The heading still renders immediately, so the frame and its title are there
 * from the first paint rather than the page appearing broken.
 */
export function PageSkeleton({ heading }: { heading: string }) {
  usePageLoading();

  return <s-page inlineSize="large" heading={heading} />;
}

/**
 * The same two states for something rendered inside a page that already
 * exists -- a panel beside a rail, a section of a larger screen.
 *
 * These are separate from the two above because an s-page cannot contain
 * another one. A caller that is already inside a page has to say so, and the
 * alternative was every such caller writing its own spinner and its own
 * banner, which is how they drift apart.
 */
export function InlineLoading({ heading }: { heading?: string }) {
  usePageLoading();

  return (
    <Card heading={heading}>
      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-spinner accessibilityLabel="Loading" />
        <s-text color="subdued">Loading…</s-text>
      </s-stack>
    </Card>
  );
}

export function InlineError({
  heading,
  error,
  onRetry,
}: {
  heading?: string;
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <Card heading={heading}>
      <s-banner tone="critical" heading="This could not load">
        <s-paragraph>{messageFor(error)}</s-paragraph>
      </s-banner>
      {onRetry ? (
        <s-stack direction="inline">
          <s-button onClick={onRetry}>Try again</s-button>
        </s-stack>
      ) : null}
    </Card>
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
  const message = messageFor(error);

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

/** One sentence for a failure, whether or not the API named one. */
function messageFor(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Something went wrong loading this.";
}
