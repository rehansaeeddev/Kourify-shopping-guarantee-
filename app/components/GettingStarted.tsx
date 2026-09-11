import { useState } from "react";

type Step = {
  label: string;
  detail: string;
  done: boolean;
  action?: { label: string; href: string };
};

/**
 * App Home's native Setup guide composition: a section with a progress line and
 * a bordered checklist. Each step is an s-checkbox — the checkbox itself is the
 * completion control, so it ticks automatically as the underlying step is done
 * (badges on, protection live, first claim reviewed). A chevron expands each
 * step's detail and its call to action, and the whole guide collapses from the
 * header. No custom badges or icons carry state — the checkbox does, which is
 * what makes it read as a Shopify built-in rather than a hand-rolled list.
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
  const doneCount = steps.filter((s) => s.done).length;
  const firstIncomplete = steps.findIndex((s) => !s.done);

  const [collapsed, setCollapsed] = useState(false);
  // Open the first unfinished step so the next action is visible at a glance.
  const [expanded, setExpanded] = useState<Record<number, boolean>>(
    firstIncomplete === -1 ? {} : { [firstIncomplete]: true },
  );

  // No manual dismiss: hiding this before setup is complete would bury guidance
  // the merchant still needs. It auto-hides once every step is done.
  if (doneCount === steps.length) return null;

  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-grid
          gridTemplateColumns="1fr auto"
          gap="small-300"
          alignItems="center"
        >
          <s-stack direction="block" gap="small-300">
            <s-heading>{title}</s-heading>
            <s-text color="subdued">
              {`${doneCount} of ${steps.length} steps completed · about ${estimatedMinutes} minutes to finish`}
            </s-text>
          </s-stack>
          <s-button
            variant="tertiary"
            accessibilityLabel={
              collapsed ? "Expand setup guide" : "Collapse setup guide"
            }
            icon={collapsed ? "chevron-down" : "chevron-up"}
            onClick={() => setCollapsed((value) => !value)}
          ></s-button>
        </s-grid>

        <s-box
          borderWidth="base"
          borderColor="base"
          borderRadius="base"
          display={collapsed ? "none" : "auto"}
        >
          {steps.map((step, index) => (
            <s-box key={step.label}>
              {index > 0 ? <s-divider /> : null}
              <s-box padding="small-200">
                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small-200"
                  alignItems="center"
                >
                  <s-checkbox label={step.label} checked={step.done} />
                  <s-button
                    variant="tertiary"
                    accessibilityLabel={`Toggle ${step.label} details`}
                    icon={expanded[index] ? "chevron-up" : "chevron-down"}
                    onClick={() =>
                      setExpanded((value) => ({
                        ...value,
                        [index]: !value[index],
                      }))
                    }
                  ></s-button>
                </s-grid>
                <s-box
                  display={expanded[index] ? "auto" : "none"}
                  paddingBlockStart="small-200"
                >
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-stack direction="block" gap="small-200">
                      <s-paragraph>{step.detail}</s-paragraph>
                      {step.action && (
                        <s-stack direction="inline">
                          <s-button variant="primary" href={step.action.href}>
                            {step.action.label}
                          </s-button>
                        </s-stack>
                      )}
                    </s-stack>
                  </s-box>
                </s-box>
              </s-box>
            </s-box>
          ))}
        </s-box>

        {help && (
          <s-paragraph color="subdued">
            <s-link href={help.href}>{help.label}</s-link>
          </s-paragraph>
        )}
      </s-stack>
    </s-section>
  );
}
