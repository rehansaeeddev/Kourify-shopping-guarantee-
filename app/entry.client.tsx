import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

/**
 * Client entry for the single-page build.
 *
 * React Router prerenders an empty shell at build time and hydrates it here,
 * so this is where the app actually starts — there is no server render to
 * take over from. HydratedRouter is the SPA-mode router; RouterProvider is
 * for a framework-less setup and takes a router this build never constructs.
 */
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
