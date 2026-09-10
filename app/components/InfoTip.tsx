import type { ReactNode } from "react";

/**
 * Help text one hover (or keyboard focus) away, so a full aside panel doesn't
 * have to live in the header. Polaris pairs an element carrying `interestFor`
 * with the tooltip's id — no trigger of our own.
 */
export function InfoTip({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <s-stack direction="inline" gap="small-500" alignItems="center">
      <s-text color="subdued">{label}</s-text>
      <s-icon type="info" size="small" color="subdued" interestFor={id} />
      <s-tooltip id={id}>{children}</s-tooltip>
    </s-stack>
  );
}
