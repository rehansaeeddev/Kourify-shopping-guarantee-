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
  children?: ReactNode;
};

// "gradient" is kept as an alias for the primary CTA for backward compatibility.
const VARIANT_CLASS: Record<Variant, string> = {
  primary: "app-btn app-btn--primary",
  gradient: "app-btn app-btn--primary",
  secondary: "app-btn app-btn--secondary",
};

export function AppButton({
  variant = "primary",
  type,
  href,
  disabled,
  onClick,
  command,
  commandFor,
  slot,
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

  // A disabled link isn't inert, so render disabled buttons as <button>.
  if (href && !disabled) {
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
