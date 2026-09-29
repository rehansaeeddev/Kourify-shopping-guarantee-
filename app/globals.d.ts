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

/**
 * App Bridge installs `shopify` on the page — it is not an npm import, so
 * nothing ships a type for it.
 *
 * Declared here once, and at the top level: this file is a global script, not
 * a module, so `interface Window` merges straight into the global one. Adding
 * an `import` or `export` anywhere in it would turn it into a module and take
 * the React namespace above out of global scope with it.
 *
 * It lives here rather than in the two files that use it because two modules
 * each augmenting `Window.shopify` with the half they need is a type error,
 * not a merge — every declaration of a property has to agree on its type.
 */
interface Window {
  shopify?: {
    /** Mints the short-lived session token every API call carries. */
    idToken?: () => Promise<string>;
    toast?: {
      show: (
        message: string,
        options?: { isError?: boolean; duration?: number },
      ) => void;
    };
  };
}
