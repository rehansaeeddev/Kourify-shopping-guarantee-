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
        {/* The icon sits on its own tile rather than loose on the page. A
          single grey glyph on white reads as something that failed to load;
          the same glyph on a surface reads as a state someone designed. */}
        <s-box padding="base" background="subdued" borderRadius="large">
          <s-icon type={icon as never} size="base" color="subdued" />
        </s-box>
        <s-heading>{heading}</s-heading>
        <s-paragraph color="subdued">{description}</s-paragraph>
        {action}
      </s-stack>
    </s-box>
  );
}
