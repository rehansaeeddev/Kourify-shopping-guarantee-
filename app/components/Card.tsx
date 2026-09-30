import { type ReactNode } from "react";

/**
 * The size a section draws its own heading at.
 *
 * s-section renders its heading inside its header, where a scoped rule puts
 * it on display-small (1.125rem). A bare s-heading has no such rule and falls
 * to heading-medium (.8125rem), so any card that draws its own title -- the
 * fill variant below, and every metric tile -- looks a size down from the
 * sections beside it unless it asks for this.
 *
 * Spread rather than written as a prop: Polaris reads `size` off the element
 * at runtime, but the published v1.0 types for s-heading do not declare it.
 */
const SECTION_HEADING_SIZE = { size: "large-200" } as Record<string, string>;

/**
 * The size a metric tile draws its label and figure at.
 *
 * A step above the section titles rather than level with them: these four
 * cards are the first thing on the page and the figures are the reason a
 * merchant opens it, so they lead rather than match. large-300 is 1.5rem.
 */
const METRIC_HEADING_SIZE = { size: "large-300" } as Record<string, string>;

type CardProps = {
  heading?: string;
  locked?: boolean;
  /**
   * Draw the card as a box with its heading inside, instead of as a section
   * with the heading above the surface.
   *
   * Two things need this. A card that has to fill its grid cell, because
   * s-section takes no size prop -- that is `fill`. And the first card of a
   * settings panel, because a heading above the surface starts the panel one
   * heading lower than the rail beside it, and the two then look unrelated.
   *
   * Everywhere else a section is the right element for a page region, and the
   * heading belongs where Polaris puts it.
   */
  boxed?: boolean;
  /** As `boxed`, and also fills the height of its grid cell. */
  fill?: boolean;
  children: ReactNode;
};

/**
 * A page section. s-section draws the card and its heading itself, so this is
 * only here to keep the `locked` badge consistent across pages -- except in
 * the two cases above, where the surface has to be drawn by hand.
 */
export function Card({ heading, locked, boxed, fill, children }: CardProps) {
  const lockedBadge = locked ? (
    <s-stack direction="inline">
      <s-badge tone="warning" icon="lock">
        Locked
      </s-badge>
    </s-stack>
  ) : null;

  if (boxed || fill) {
    return (
      <s-box
        blockSize={fill ? "100%" : undefined}
        padding="base"
        background="base"
        borderWidth="base"
        /*
         | base, and not subdued, although a section's own ring is lighter
         | than that. A section is a ring *and* a soft drop shadow, and s-box
         | has no boxShadow prop to match the second half with. Matching only
         | the ring left these cards looking faded beside the sections rather
         | than level with them, so the border carries the weight the missing
         | shadow would have. The radius needed nothing: both land on 12px.
         */
        borderColor="base"
        borderRadius="large"
      >
        <s-stack direction="block" gap="base">
          {heading ? (
            <s-heading {...SECTION_HEADING_SIZE}>{heading}</s-heading>
          ) : null}
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
        <s-heading {...METRIC_HEADING_SIZE}>{label}</s-heading>
        {/* A heading too, so both halves of the row sit at the size every
          other card title on the page uses. s-heading takes no size prop,
          so which element is used is the only control there is. */}
        <s-heading {...METRIC_HEADING_SIZE}>{value}</s-heading>
      </s-stack>
      {/* s-heading takes no tone either, so the figure cannot carry one. The
        sub-line does instead -- that is what keeps "2 open claims" reading
        as something to act on rather than just a number. */}
      {sub ? <s-text tone={TONE_TO_TEXT_TONE[tone]}>{sub}</s-text> : null}
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
