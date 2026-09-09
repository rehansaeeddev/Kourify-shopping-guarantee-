import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";

/**
 * Wires an <s-table>'s native Previous/Next pagination to a page-based
 * loader. The custom element's own event names are lowercase
 * ("nextpage"/"previouspage") while React (pre-19) doesn't auto-bind
 * arbitrary camelCase onXxx JSX props to custom-element events the way it
 * does for its own known synthetic events — an onNextPage prop is set as an
 * inert property, never invoked. So these are wired with a real
 * addEventListener via ref instead.
 */
export function useTablePagination(
  page: number,
  totalPages: number,
  pageHref: (targetPage: number) => string,
) {
  const ref = useRef<HTMLElement>(null);
  const navigate = useNavigate();

  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;
  const paginate = totalPages > 1;

  useEffect(() => {
    const el = ref.current as
      | (HTMLElement & {
          paginate?: boolean;
          hasNextPage?: boolean;
          hasPreviousPage?: boolean;
        })
      | null;
    if (!el) return;
    // Set as real DOM properties (not just JSX props) so this doesn't rely
    // on React's custom-element prop-to-property mapping for anything.
    el.paginate = paginate;
    el.hasNextPage = hasNextPage;
    el.hasPreviousPage = hasPreviousPage;
    const onNext = () => navigate(pageHref(page + 1));
    const onPrevious = () => navigate(pageHref(page - 1));
    el.addEventListener("nextpage", onNext);
    el.addEventListener("previouspage", onPrevious);
    return () => {
      el.removeEventListener("nextpage", onNext);
      el.removeEventListener("previouspage", onPrevious);
    };
  }, [page, pageHref, navigate, paginate, hasNextPage, hasPreviousPage]);

  return {
    ref,
    paginate: totalPages > 1,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
