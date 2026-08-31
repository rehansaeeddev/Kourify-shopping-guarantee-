import type { ReactNode } from "react";

type CardProps = {
  heading?: string;
  children: ReactNode;
};

export function Card({ heading, children }: CardProps) {
  return (
    <s-section>
      {heading && <h3 className="app-card__heading">{heading}</h3>}
      {children}
    </s-section>
  );
}

type StatTileProps = {
  label: string;
  value: string;
  icon: string;
  tone?: "default" | "success" | "warning" | "critical";
  href?: string;
};

const TONE_TO_ICON_TONE: Record<string, "neutral" | "success" | "warning" | "critical"> = {
  default: "neutral",
  success: "success",
  warning: "warning",
  critical: "critical",
};

export function StatTile({ label, value, icon, tone = "default", href }: StatTileProps) {
  const content = (
    <s-stack direction="inline" gap="base" alignItems="center">
      <s-box padding="small-200" borderRadius="base" background="subdued">
        <s-icon type={icon as never} tone={TONE_TO_ICON_TONE[tone]} />
      </s-box>
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-text type="strong">{value}</s-text>
      </s-stack>
    </s-stack>
  );

  if (href) {
    return (
      <s-clickable
        href={href}
        padding="base"
        borderWidth="base"
        borderColor="base"
        borderRadius="base"
        background="base"
      >
        {content}
      </s-clickable>
    );
  }

  return (
    <s-box padding="base" borderWidth="base" borderColor="base" borderRadius="base" background="base">
      {content}
    </s-box>
  );
}
