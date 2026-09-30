import { useEffect } from "react";

/**
 * Drives the Shopify admin's own loading indicator.
 *
 * Pages used to render a spinner in a section of their own while their data
 * was in flight. The admin already has somewhere to say this -- a bar in its
 * header -- so the page no longer draws one.
 *
 * The count is the point. `shopify.loading` takes a boolean and does not
 * track overlapping callers, so two pages or queries loading at once would
 * have the first one to finish switch the indicator off while the second was
 * still going. Only the last one out stops it.
 */
let active = 0;

function set(isLoading: boolean) {
  window.shopify?.loading?.(isLoading);
}

export function usePageLoading() {
  useEffect(() => {
    active += 1;
    if (active === 1) set(true);

    return () => {
      active -= 1;
      if (active === 0) set(false);
    };
  }, []);
}
