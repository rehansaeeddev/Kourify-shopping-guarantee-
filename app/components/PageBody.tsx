import type { ReactNode } from "react";

/**
 * How wide a page's content actually runs.
 *
 * s-page offers only two useful widths: `base`, a narrow fixed column, and
 * `large`, the full frame. Neither read well here, so every page is set to
 * `large` and its content capped by the single centred grid track below.
 * The number lives here alone — tuning it is one edit, not thirteen.
 */
const MAX_INLINE_SIZE = "1400px";

/**
 * The stack is not decoration. Once the sections sit inside a grid track they
 * are no longer s-page's direct children, so the spacing s-page puts between
 * them stops applying and has to be stated.
 */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <s-grid
      gridTemplateColumns={`minmax(0, ${MAX_INLINE_SIZE})`}
      justifyContent="center"
    >
      <s-stack direction="block" gap="large">
        {children}
      </s-stack>
    </s-grid>
  );
}
