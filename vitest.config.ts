import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /*
     * jsdom rather than node: the API client reads window.shopify for the
     * session token and builds a real anchor to hand the browser a download,
     * and both are exactly the parts worth testing.
     */
    environment: "jsdom",
    include: ["app/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
