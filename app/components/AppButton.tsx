import type { ReactNode } from "react";

type AppButtonProps = {
  variant?: "primary" | "secondary" | "gradient";
  type?: "button" | "submit" | "reset";
  href?: string;
  disabled?: boolean;
  onClick?: (event: Event) => void;
  command?: string;
  commandFor?: string;
  slot?: string;
  children?: ReactNode;
};

export function AppButton({ variant = "primary", type, href, disabled, onClick, command, commandFor, slot, children }: AppButtonProps) {
  if (variant === "gradient") {
    const Tag = href ? "a" : "button";
    return (
      <Tag
        className="app-btn-gradient"
        href={href}
        type={href ? undefined : (type ?? "button")}
        disabled={disabled}
        onClick={onClick as never}
        slot={slot}
      >
        {children}
      </Tag>
    );
  }

  return (
    <s-button
      variant={variant}
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
