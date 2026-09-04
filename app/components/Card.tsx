import type { ReactNode } from "react";
import { Link } from "react-router";

type CardProps = {
  heading?: string;
  locked?: boolean;
  children: ReactNode;
};

export function Card({ heading, locked, children }: CardProps) {
  return (
    <s-section>
      {heading && (
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <h3 className="app-card__heading">{heading}</h3>
          {locked && <s-badge tone="warning">🔒 Locked</s-badge>}
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
};

const TONE_TO_ICON_TONE: Record<string, "neutral" | "success" | "warning" | "critical"> = {
  default: "neutral",
  success: "success",
  warning: "warning",
  critical: "critical",
};

export function StatTile({ label, value, icon, tone = "default", href }: StatTileProps) {
  const className = `app-stat-tile app-stat-tile--${tone}`;
  const content = (
    <>
      <div className="app-stat-tile__icon">
        <s-icon type={icon as never} tone={TONE_TO_ICON_TONE[tone]} />
      </div>
      <div className="app-stat-tile__body">
        <span className="app-stat-tile__label">{label}</span>
        <span className="app-stat-tile__value">{value}</span>
      </div>
    </>
  );

  if (href) {
    // Internal app route → Link keeps navigation client-side (and embedded).
    return (
      <Link className={`${className} app-stat-tile--clickable`} to={href}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
