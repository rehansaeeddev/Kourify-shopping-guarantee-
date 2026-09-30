import { ApiError } from "../lib/api";
import { Card } from "./Card";
import { usePageLoading } from "../lib/loading";
import { PageBody } from "./PageBody";

/**
 * What something shows while its data is in flight: nothing of its own.
 *
 * The admin already reports this, in its header, and App Bridge's Loading API
 * is how an app joins in -- usePageLoading below. A card in the page saying
 * "Loading…" on top of that is a second signal for the same thing, and the
 * slower-feeling one: it is a box that exists only to be replaced, and it
 * moves the content down until it goes.
 *
 * So this renders nothing and only drives the indicator. It is still a
 * component rather than a bare hook call, because every page and panel
 * already branches on `isPending` and returning this keeps that branch where
 * it is -- and keeps the decision in one file if it is ever revisited.
 */
export function InlineLoading() {
  usePageLoading();

  return null;
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
  usePageLoading();

  /*
   | The heading and nothing else. It renders immediately, so the frame and
   | its title are there from the first paint rather than the page looking
   | broken, and what fills in underneath is the real content -- never a
   | placeholder that has to be taken away again.
   */
  return <s-page inlineSize="large" heading={heading} />;
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
