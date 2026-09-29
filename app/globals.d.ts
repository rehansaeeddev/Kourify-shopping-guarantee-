declare module "*.css";

/**
 * s-app-nav is the one Polaris element @shopify/polaris-types does not ship a
 * definition for, so it is declared here.
 *
 * Declared inside React's own namespace rather than a global `JSX` one: React
 * 19 moved JSX.IntrinsicElements under React, and a global declaration is
 * simply never consulted.
 */
declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
