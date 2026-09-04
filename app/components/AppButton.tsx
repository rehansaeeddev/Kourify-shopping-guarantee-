import type { ReactNode } from "react";
import { Link } from "react-router";

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
  /** Force a full-document anchor (e.g. a file download) instead of SPA nav. */
  download?: boolean;
  children?: ReactNode;
};

// "gradient" is kept as an alias for the primary CTA for backward compatibility.
const VARIANT_CLASS: Record<Variant, string> = {
  primary: "app-btn app-btn--primary",
  gradient: "app-btn app-btn--primary",
  secondary: "app-btn app-btn--secondary",
};

// shopify://, http(s):, mailto: etc. — anything with a URL scheme is external
// and must be a plain anchor (App Bridge intercepts shopify:// clicks).
function hasScheme(href: string): boolean {
  return /^[a-zA-Z][\w+.-]*:/.test(href);
}

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
  // Buttons that drive a Polaris modal via command/commandFor must stay
  // s-button — that behaviour only exists on the web component.
  if (command || commandFor) {
    return (
      <s-button
        variant={variant === "gradient" ? "primary" : variant}
        type={href ? undefined : (type ?? "button")}
        href={href}
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

  const className =
    VARIANT_CLASS[variant] + (disabled ? " app-btn--disabled" : "");

  if (href && !disabled) {
    // External links and downloads use a real anchor; internal app routes use
    // React Router's Link so navigation stays client-side and keeps the
    // embedded App Bridge session (a full <a> nav bounces to auth/home).
    if (download || hasScheme(href)) {
      return (
        <a
          className={className}
          href={href}
          slot={slot}
          onClick={onClick as never}
        >
          {children}
        </a>
      );
    }
    return (
      <Link
        className={className}
        to={href}
        slot={slot}
        onClick={onClick as never}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      className={className}
      type={type ?? "button"}
      disabled={disabled}
      onClick={onClick as never}
      slot={slot}
    >
      {children}
    </button>
  );
}
