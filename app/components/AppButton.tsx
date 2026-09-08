import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "gradient";

type AppButtonProps = {
  variant?: Variant;
  type?: "button" | "submit" | "reset";
  href?: string;
  disabled?: boolean;
  onClick?: (event: Event) => void;
  command?: string;
  commandFor?: string;
  slot?: string;
  /** Force a full navigation instead of Shopify's SPA intercept — needed for
   * file downloads, where a client-side route change would break the
   * browser's download prompt. */
  download?: boolean;
  children?: ReactNode;
};

// "gradient" is kept as an alias for the primary CTA for backward compatibility.
const POLARIS_VARIANT: Record<Variant, "primary" | "secondary"> = {
  primary: "primary",
  gradient: "primary",
  secondary: "secondary",
};

/**
 * Thin, unstyled wrapper around Shopify's native `<s-button>` — every button
 * in the app is stock Polaris, no custom CSS/colors. `href` is passed
 * straight through: Shopify's own polaris.js ships a global click delegate
 * that special-cases `s-button[href]`, dispatching a cancelable
 * `shopify:navigate` event that the app's `AppProvider` listens for and
 * routes through React Router — so internal links stay client-side with no
 * custom navigation code here. That delegate only skips same-origin hrefs
 * that carry a non-default `target`, which is what forces a real
 * (downloadable) request for `download` links.
 */
export function AppButton({
  variant = "primary",
  type,
  href,
  disabled,
  onClick,
  command,
  commandFor,
  slot,
  download,
  children,
}: AppButtonProps) {
  return (
    <s-button
      variant={POLARIS_VARIANT[variant]}
      type={href ? undefined : (type ?? "button")}
      href={href}
      target={download ? "_blank" : undefined}
      disabled={disabled}
      onClick={onClick as never}
      command={command as never}
      commandFor={commandFor}
      slot={slot as never}
    >
      {children}
    </s-button>
  );
}
