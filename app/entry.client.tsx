import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydrateFallback, RouterProvider } from "react-router/dom";

/**
 * Client entry for the single-page build.
 *
 * React Router prerenders an empty shell at build time and hydrates it here,
 * so this is where the app actually starts — there is no server render to
 * take over from.
 */
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RouterProvider fallbackElement={<HydrateFallback />} />
    </StrictMode>,
  );
});
