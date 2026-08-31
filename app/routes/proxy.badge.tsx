// Deprecated: superseded by proxy.settings.tsx, which the storefront now
// fetches for both badges and protection to avoid two round-trips on pages
// that show both widgets. Kept as an alias in case anything external still
// calls this URL directly. Safe to delete this file.
export { loader } from "./proxy.settings";
