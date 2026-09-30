import { type ReactNode } from "react";

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
 * One metric, as its own card.
 *
 * These used to be borderless tiles sharing a single section, separated by
 * vertical rules -- the composition Shopify's own Orders page uses. Read on
 * the page it turned out to be four figures inside one slab rather than four
 * things, so each now carries its own surface and the rules are gone.
 *
 * Tone colours the icon only, never the figure, so colour is never the one
 * thing carrying a metric's meaning.
 */
export function StatTile({
  label,
  value,
  icon,
  tone = "default",
  href,
  sub,
}: StatTileProps) {
  const body = (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-icon type={icon as never} tone={TONE_TO_ICON_TONE[tone]} size="base" />
        <s-text color="subdued">{label}</s-text>
      </s-stack>
      <s-heading>{value}</s-heading>
      {/* The sub-line rides as a neutral badge, not caption text, so each
        metric ends on a crisp grey pill. Colour is never spent here -- the
        tone icon already carries the metric's signal, so a badge never
        dresses a plain descriptor up as a status. */}
      {sub ? (
        <s-stack direction="inline">
          <s-badge tone="neutral">{sub}</s-badge>
        </s-stack>
      ) : null}
    </s-stack>
  );

  // s-clickable draws its own surface, so the card props go on whichever of
  // the two is actually rendered rather than nesting a box inside a link.
  if (href) {
    return (
      <s-clickable
        href={href}
        padding="base"
        background="base"
        borderWidth="base"
        borderColor="base"
        borderRadius="large"
        accessibilityLabel={`${label}: ${value}`}
      >
        {body}
      </s-clickable>
    );
  }

  return (
    <s-box
      padding="base"
      background="base"
      borderWidth="base"
      borderColor="base"
      borderRadius="large"
    >
      {body}
    </s-box>
  );
}

export type Metric = StatTileProps;

/**
 * A row of metric cards.
 *
 * With a heading or description this stays a section, because those name a
 * region and a region needs a surface to sit in. Without them the grid is
 * rendered bare: the cards are the surfaces, and a section around them would
 * be a box drawn around four boxes.
 */
export function MetricsCard({
  heading,
  accessibilityLabel,
  description,
  metrics,
}: {
  heading?: string;
  /**
   * What to call the row when it carries no visible heading.
   *
   * Only used when there is a section to name. A bare row of cards needs no
   * label of its own -- every card already says what it is.
   */
  accessibilityLabel?: string;
  description?: string;
  metrics: Metric[];
}) {
  const columns = metrics.map(() => "1fr").join(" ");

  const grid = (
    <s-grid
      gridTemplateColumns={`@container (inline-size <= 640px) 1fr, @container (inline-size <= 960px) 1fr 1fr, ${columns}`}
      gap="base"
      alignItems="stretch"
    >
      {metrics.map((metric) => (
        <StatTile key={metric.label} {...metric} />
      ))}
    </s-grid>
  );

  if (!heading && !description) return grid;

  return (
    <s-section heading={heading} accessibilityLabel={accessibilityLabel}>
      {description ? (
        <s-paragraph color="subdued">{description}</s-paragraph>
      ) : null}
      {grid}
    </s-section>
  );
}
