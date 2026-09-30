import { ApiError } from "../lib/api";
import { Card } from "./Card";
import { usePageLoading } from "../lib/loading";
import { PageBody } from "./PageBody";

/**
 * What something shows while its data is in flight, and what it shows when
 * that data could not be fetched.
 *
 * Two pairs, because an s-page cannot contain another one. The Inline pair is
 * the content on its own, for anything already rendered inside a page -- a
 * panel beside a rail, a section of a larger screen. The Page pair is the
 * same content with a page around it.
 *
 * They are a pair rather than four separate components so the two cannot
 * drift: before this, anything inside an existing page wrote its own spinner
 * and its own banner, and they had already started to differ.
 *
 * Both loading states also drive the Shopify admin's own header indicator, so
 * the merchant gets the admin's usual signal on top of whatever is on screen.
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
 * The heading renders immediately, so the frame and its title are there from
 * the first paint rather than the page appearing broken while it waits.
 */
export function PageSkeleton({ heading }: { heading: string }) {
  return (
    <s-page inlineSize="large" heading={heading}>
      <PageBody>
        <InlineLoading />
      </PageBody>
    </s-page>
  );
}

/**
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
  return (
    <s-page inlineSize="large" heading={heading}>
      <PageBody>
        <InlineError error={error} onRetry={onRetry} />
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
