import { useState } from "react";
import { Card } from "./Card";
import { AppButton } from "./AppButton";

type Step = {
  label: string;
  detail: string;
  done: boolean;
  action?: { label: string; href: string };
};

export function GettingStarted({
  title,
  steps,
  estimatedMinutes = 3,
}: {
  title: string;
  steps: Step[];
  estimatedMinutes?: number;
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
    <Card>
      <div className="app-getting-started__header">
        <div className="app-getting-started__heading-row">
          <div className="app-getting-started__icon">
            <s-icon type="reward" tone="auto" />
          </div>
          <div>
            <h4 className="app-getting-started__title">{title}</h4>
            <p className="app-getting-started__subtitle">
              {doneCount} of {steps.length} steps complete · ~{estimatedMinutes} min to finish
            </p>
          </div>
        </div>
      </div>

      <ol className="app-stepper">
        {steps.map((step, index) => {
          const isDone = step.done;
          const isActive = index === activeIndex;
          const connectorDone = index > 0 && steps[index - 1].done;
          return (
            <li
              key={step.label}
              className={
                "app-stepper__step" +
                (index > 0 ? " app-stepper__step--connected" : "") +
                (connectorDone ? " app-stepper__step--connector-done" : "")
              }
            >
              <button
                type="button"
                className="app-stepper__button"
                onClick={() => setActiveIndex(index)}
                aria-current={isActive ? "step" : undefined}
              >
                <span
                  className={
                    "app-stepper__circle" +
                    (isDone ? " app-stepper__circle--done" : "") +
                    (isActive && !isDone ? " app-stepper__circle--current" : "")
                  }
                >
                  {isDone ? "✓" : isActive ? <span className="app-stepper__dot" /> : ""}
                </span>
                <span
                  className={
                    "app-stepper__label" +
                    (isActive ? " app-stepper__label--current" : "") +
                    (isDone ? " app-stepper__label--done" : "")
                  }
                >
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="app-stepper__panel">
        <div className="app-getting-started__detail">{activeStep.detail}</div>
        {activeStep.action ? (
          <div className="app-getting-started__row-action">
            <AppButton variant="gradient" href={activeStep.action.href}>
              {activeStep.action.label}
            </AppButton>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
