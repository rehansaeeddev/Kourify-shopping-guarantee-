import { useState } from "react";

type Step = {
  label: string;
  detail: string;
  done: boolean;
  /** Shown in the next-step tile. Falls back to a neutral marker. */
  icon?: string;
  /** Roughly how long this one step takes, when it is the next one. */
  minutes?: number;
  action?: { label: string; href: string };
};

/**
 * App Home's Setup guide composition.
 *
 * Two things here are deliberate departures from the documented example, both
 * because that example assumes a checklist the merchant ticks themselves:
 *
 * Completion is an icon, not a checkbox. Every step here is derived — badges
 * are on, protection is live, a claim has been reviewed — so a checkbox would
 * be an enabled control that does nothing when clicked. A check icon says the
 * same thing and promises nothing it cannot do.
 *
 * Each step's action is on its row, not behind a chevron. The whole point of
 * the guide is what to do next; making the merchant expand a row to find out
 * hides the one thing it exists to show.
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
  const next = steps.find((s) => !s.done);

  const [collapsed, setCollapsed] = useState(false);

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
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-heading>{title}</s-heading>
            {/* Progress as a badge rather than a line of grey text: it is the
              one genuinely positive thing in the header, and a tone is how
              Polaris says so without any colour of ours. */}
            <s-badge tone={doneCount > 0 ? "success" : "neutral"}>
              {`${doneCount} of ${steps.length} done`}
            </s-badge>
          </s-stack>
          <s-button
            variant="tertiary"
            tone="neutral"
            accessibilityLabel={collapsed ? "Show all steps" : "Hide all steps"}
            icon={collapsed ? "chevron-down" : "chevron-up"}
            onClick={() => setCollapsed((value) => !value)}
          ></s-button>
        </s-grid>

        {/* The next step, lifted out of the list.
          A merchant opening this page is asking one question, and the answer
          is one of these rows. Giving that row its own surface, its icon and
          its button answers it before they read anything else. */}
        {next && !collapsed && (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-grid
              gridTemplateColumns="@container (inline-size <= 640px) 1fr, auto 1fr auto"
              gap="base"
              alignItems="center"
            >
              <s-box padding="small-200" background="base" borderRadius="base">
                <s-icon
                  type={(next.icon ?? "circle") as never}
                  tone="success"
                  size="base"
                />
              </s-box>
              <s-stack direction="block" gap="small-300">
                <s-text tone="success" type="strong">
                  {`Next step · about ${next.minutes ?? estimatedMinutes} min`}
                </s-text>
                <s-heading>{next.label}</s-heading>
                <s-text color="subdued">{next.detail}</s-text>
              </s-stack>
              {next.action && (
                <s-stack direction="inline">
                  <s-button variant="primary" href={next.action.href}>
                    {next.action.label}
                  </s-button>
                </s-stack>
              )}
            </s-grid>
          </s-box>
        )}

        <s-box
          borderWidth="base"
          borderColor="strong"
          borderRadius="base"
          display={collapsed ? "none" : "auto"}
        >
          {steps.map((step, index) => (
            <s-box key={step.label}>
              {index > 0 ? <s-divider /> : null}
              <s-box padding="small">
                <s-grid
                  gridTemplateColumns="auto 1fr auto"
                  gap="small-300"
                  alignItems="center"
                >
                  {/* Filled and green when done, a hollow outline when not.
                    Shape carries it as well as colour, so the state survives
                    a monochrome screen and a colour-blind reader. */}
                  <s-stack direction="inline" alignItems="center">
                    <s-icon
                      type={step.done ? "check-circle-filled" : "circle"}
                      tone={step.done ? "success" : "neutral"}
                      size="base"
                    />
                    {/* s-icon takes no label, and the shape alone is nothing
                      a screen reader can read out. */}
                    <s-text accessibilityVisibility="exclusive">
                      {step.done ? "Done" : "Not done yet"}
                    </s-text>
                  </s-stack>
                  <s-text
                    type={step.done ? "generic" : "strong"}
                    color={step.done ? "subdued" : "base"}
                  >
                    {step.label}
                  </s-text>
                  {step.action ? (
                    <s-link href={step.action.href}>{step.action.label}</s-link>
                  ) : null}
                </s-grid>
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
