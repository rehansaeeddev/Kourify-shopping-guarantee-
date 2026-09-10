import { useState } from "react";
import { Card } from "./Card";

type Step = {
  label: string;
  detail: string;
  done: boolean;
  action?: { label: string; href: string };
};

/**
 * App Home's setup-guide composition: the steps as a list you can click
 * through, with the selected one showing its detail and its call to action.
 *
 * A step's state is carried by its icon *and* its wording, never by colour
 * alone — the check icon reads the same to someone who can't tell the tones
 * apart.
 */
export function GettingStarted({
  title,
  steps,
  estimatedMinutes = 3,
  help,
}: {
  title: string;
  steps: Step[];
  estimatedMinutes?: number;
  help?: { label: string; href: string };
}) {
  const firstIncompleteIndex = steps.findIndex((s) => !s.done);
  const [activeIndex, setActiveIndex] = useState(
    firstIncompleteIndex === -1 ? steps.length - 1 : firstIncompleteIndex,
  );

  const doneCount = steps.filter((s) => s.done).length;

  // No manual dismiss: hiding this before setup is actually complete would
  // bury guidance the merchant still needs, with no way to bring it back
  // short of a full page reload. It auto-hides once every step is done.
  if (doneCount === steps.length) return null;

  const activeStep = steps[activeIndex];

  return (
    <Card heading={title}>
      <s-paragraph color="subdued">
        {`${doneCount} of ${steps.length} steps complete · about ${estimatedMinutes} minutes to finish`}
      </s-paragraph>

      <s-stack direction="block" gap="small-200">
        {steps.map((step, index) => (
          <s-clickable
            key={step.label}
            padding="small-200"
            borderRadius="base"
            background={index === activeIndex ? "subdued" : undefined}
            accessibilityLabel={`${step.label}${step.done ? ", done" : ""}`}
            onClick={() => setActiveIndex(index)}
          >
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon
                type={step.done ? "check-circle" : "circle"}
                tone={step.done ? "success" : "neutral"}
                size="base"
              />
              <s-text type={index === activeIndex ? "strong" : undefined}>
                {step.label}
              </s-text>
              {step.done && <s-badge tone="success">Done</s-badge>}
            </s-stack>
          </s-clickable>
        ))}
      </s-stack>

      <s-stack direction="block" gap="base">
        <s-paragraph>{activeStep.detail}</s-paragraph>
        {activeStep.action && (
          <s-stack direction="inline">
            <s-button variant="primary" href={activeStep.action.href}>
              {activeStep.action.label}
            </s-button>
          </s-stack>
        )}
        {help && (
          <s-paragraph color="subdued">
            <s-link href={help.href}>{help.label}</s-link>
          </s-paragraph>
        )}
      </s-stack>
    </Card>
  );
}
