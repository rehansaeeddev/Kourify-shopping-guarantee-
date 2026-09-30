import { type ReactNode } from "react";

type CardProps = {
  heading?: string;
  locked?: boolean;
  /**
   * Fill the height of the grid cell this card sits in.
   *
   * Needed because s-section cannot: it takes no size prop, so two sections
   * side by side in a stretched grid stand at whatever height their content
   * gives them, and the shorter one reads as unfinished rather than shorter.
   * Set this on cards that sit beside each other and the surface becomes an
   * s-box with blockSize 100%, which does fill. Leave it off everywhere else
   * -- a section is the right element for a page region, and this is only a
   * way around the one thing it will not do.
   */
  fill?: boolean;
  children: ReactNode;
};

/**
 * A page section. s-section draws the card and its heading itself, so this is
 * only here to keep the `locked` badge consistent across pages -- except when
 * `fill` is set, where the surface has to be drawn by hand to get a height.
 */
export function Card({ heading, locked, fill, children }: CardProps) {
  const lockedBadge = locked ? (
    <s-stack direction="inline">
      <s-badge tone="warning" icon="lock">
        Locked
      </s-badge>
    </s-stack>
  ) : null;

  if (fill) {
    return (
      <s-box
        blockSize="100%"
        padding="base"
        background="base"
        borderWidth="base"
        borderColor="base"
        borderRadius="large"
      >
        <s-stack direction="block" gap="base">
          {heading ? <s-heading>{heading}</s-heading> : null}
          {lockedBadge}
          {children}
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-section heading={heading}>
      {lockedBadge}
      {children}
    </s-section>
  );
}

type StatTileProps = {
  label: string;
  value: string;
  /**
   * No longer rendered. Kept optional so the metric lists that still name one
   * keep type-checking; drop it from those lists and then from here.
   */
  icon?: string;
  tone?: "default" | "success" | "warning" | "critical";
  href?: string;
  /** Small text under the value — e.g. a trend delta ("2 fewer than last week"). */
  sub?: ReactNode;
};

const TONE_TO_TEXT_TONE: Record<
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
 * Label and figure sit on one line, label left and figure right, which is the
 * same shape the status rows on this page already use.
 *
 * The label is the heading and the figure is text, not the other way round --
 * that is App Home's own metrics-card composition, and it is why the figures
 * used to sit at a size of their own instead of matching every other card
 * title on the page. Tone moved onto the figure when the icons came off, so a
 * metric that means something still says so without one.
 */
export function StatTile({
  label,
  value,
  tone = "default",
  href,
  sub,
}: StatTileProps) {
  const body = (
    <s-stack direction="block" gap="small-200">
      <s-stack
        direction="inline"
        justifyContent="space-between"
        alignItems="center"
        gap="base"
      >
        <s-heading>{label}</s-heading>
        <s-text tone={TONE_TO_TEXT_TONE[tone]}>{value}</s-text>
      </s-stack>
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
      /* One query, then the default. A second @container clause is not
        supported here -- with two in the list nothing matched the default and
        every card dropped onto its own row. */
      gridTemplateColumns={`@container (inline-size <= 640px) 1fr, ${columns}`}
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
