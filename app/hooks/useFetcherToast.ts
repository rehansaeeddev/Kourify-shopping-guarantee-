import { useEffect, useRef } from "react";
import type { useFetcher } from "react-router";
import { useToast } from "../components/Toast";

/**
 * Fires a toast exactly once when a fetcher transitions from submitting/loading
 * back to idle with data. Watching `fetcher.data` alone misses the transition
 * when `state` flips to "idle" in a later render than `data` was set.
 */
export function useFetcherToast<T>(
  fetcher: ReturnType<typeof useFetcher<T>>,
  formatMessage: (data: NonNullable<ReturnType<typeof useFetcher<T>>["data"]>) => string,
) {
  const { showToast } = useToast();
  const wasActive = useRef(false);

  useEffect(() => {
    if (fetcher.state !== "idle") {
      wasActive.current = true;
      return;
    }
    if (wasActive.current && fetcher.data) {
      showToast(formatMessage(fetcher.data));
    }
    wasActive.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
}
