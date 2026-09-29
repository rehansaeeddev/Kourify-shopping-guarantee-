import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./api";

/**
 * Shared cache for every admin page.
 *
 * The defaults are set for an embedded admin: a merchant moves between pages
 * constantly and expects each to be current, but not to see a spinner every
 * time they come back to one they just left.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /*
       * Kept briefly so navigating back to a page renders from cache, then
       * refetches. Long enough to feel instant, short enough that a merchant
       * who just changed a setting sees the change.
       */
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        /*
         * A rejected request is not a flaky one: an invalid status, a
         * settlement over the ceiling or another shop's claim will be refused
         * just as firmly on the third attempt. Only server-side and network
         * failures are worth retrying.
         */
        if (error instanceof ApiError && error.status < 500) {
          return false;
        }

        return failureCount < 2;
      },
    },
    mutations: {
      // Nothing here is safe to replay on its own: a status change emails a
      // shopper and a plan change moves money.
      retry: false,
    },
  },
});
