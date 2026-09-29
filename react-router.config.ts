import type { Config } from "@react-router/dev/config";

export default {
  /**
   * Single-page app: there is no Node server here any more.
   *
   * Rendering moved to Laravel, which owns the data, the Shopify session and
   * every write. This build produces static assets that Laravel serves, and
   * the two talk over the admin API — so keeping an SSR pass would mean a
   * second runtime rendering pages it can no longer fetch data for.
   */
  ssr: false,
} satisfies Config;
