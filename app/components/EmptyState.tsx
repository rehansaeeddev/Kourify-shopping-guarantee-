import type { ReactNode } from "react";

export function EmptyState({
  icon = "image",
  heading,
  description,
  action,
}: {
  icon?: string;
  heading: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="app-empty-state">
      <div className="app-empty-state__icon">
        <s-icon type={icon as never} size="base" color="subdued" />
      </div>
      <s-heading>{heading}</s-heading>
      <s-paragraph>{description}</s-paragraph>
      {action ? <div className="app-empty-state__action">{action}</div> : null}
    </div>
  );
}
