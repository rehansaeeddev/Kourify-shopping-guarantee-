import { useEffect } from "react";

import { api } from "./api";
import { keys } from "./queries";
import { queryClient } from "./query-client";

/**
 * The queries behind the nav, warmed after the page you asked for has loaded.
 *
 * Every screen fetches its own data, so the first visit to each one showed a
 * loading card even though the app had been open for minutes. Fetching them
 * up front would have moved that cost onto the first paint instead of
 * removing it, so this waits for the browser to go idle and then fills the
 * cache: the click that follows renders from it.
 *
 * Only the queries whose keys are fixed. Orders and Claims key on their URL
 * parameters, and a prefetch that guessed those would miss the cache and buy
 * an extra request rather than save one.
 */
const WARM: Array<{ queryKey: readonly string[]; path: string }> = [
  { queryKey: keys.dashboard, path: "/dashboard" },
  { queryKey: keys.settings, path: "/settings" },
  { queryKey: keys.billing, path: "/billing" },
];

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function usePrefetchNav() {
  useEffect(() => {
    // App Bridge mints the token every one of these carries. Before it is
    // there each would throw, and three rejected queries would be cached as
    // errors for the pages they were meant to make instant.
    if (!window.shopify?.idToken) return;

    const host = window as IdleWindow;
    let cancelled = false;

    const run = () => {
      if (cancelled) return;

      for (const { queryKey, path } of WARM) {
        // Failures are silent on purpose: nothing on screen is waiting for
        // these, and the page itself will report the error properly when a
        // merchant actually opens it.
        void queryClient
          .prefetchQuery({ queryKey, queryFn: () => api.get(path) })
          .catch(() => {});
      }
    };

    if (typeof host.requestIdleCallback === "function") {
      const handle = host.requestIdleCallback(run, { timeout: 3000 });

      return () => {
        cancelled = true;
        host.cancelIdleCallback?.(handle);
      };
    }

    // Safari has no requestIdleCallback. A timeout is not idle, but it is
    // still after the first paint, which is the part that matters.
    const timer = window.setTimeout(run, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
}
