import type { ReactNode } from "react";

/**
 * Follows App Home's empty-state composition: Box, Stack, Heading, Paragraph
 * and a single call to action, with no styling of our own.
 */
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
    <s-box padding="large-100">
      <s-stack direction="block" gap="base" alignItems="center">
        <s-icon type={icon as never} size="base" color="subdued" />
        <s-heading>{heading}</s-heading>
        <s-paragraph color="subdued">{description}</s-paragraph>
        {action}
      </s-stack>
    </s-box>
  );
}
