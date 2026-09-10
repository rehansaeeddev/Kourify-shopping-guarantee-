import type { ReactNode } from "react";

type CardProps = {
  heading?: string;
  locked?: boolean;
  children: ReactNode;
};

/**
 * A page section. s-section draws the card and its heading itself, so this is
 * only here to keep the `locked` badge consistent across pages.
 */
export function Card({ heading, locked, children }: CardProps) {
  return (
    <s-section heading={heading}>
      {locked && (
        <s-stack direction="inline">
          <s-badge tone="warning" icon="lock">
            Locked
          </s-badge>
        </s-stack>
      )}
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
  /** Small text under the value — e.g. a trend delta ("2 fewer than last week"). */
  sub?: ReactNode;
};

const TONE_TO_ICON_TONE: Record<
  string,
  "neutral" | "success" | "warning" | "critical"
> = {
  default: "neutral",
  success: "success",
  warning: "warning",
  critical: "critical",
};

/**
 * One figure with its label, following App Home's metrics composition. Tone
 * colours only the icon — the figure itself stays in the default text colour
 * so colour is never the only thing carrying the meaning.
 */
export function StatTile({
  label,
  value,
  icon,
  tone = "default",
  href,
  sub,
}: StatTileProps) {
  const content = (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-icon
          type={icon as never}
          tone={TONE_TO_ICON_TONE[tone]}
          size="base"
        />
        <s-text color="subdued">{label}</s-text>
      </s-stack>
      <s-text type="strong" fontVariantNumeric="tabular-nums">
        {value}
      </s-text>
      {sub && <s-text color="subdued">{sub}</s-text>}
    </s-stack>
  );

  if (href) {
    return (
      <s-clickable
        href={href}
        padding="base"
        border="base"
        borderRadius="base"
        accessibilityLabel={`${label}: ${value}`}
      >
        {content}
      </s-clickable>
    );
  }

  return (
    <s-box padding="base" border="base" borderRadius="base">
      {content}
    </s-box>
  );
}
