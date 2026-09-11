import { Fragment, type ReactNode } from "react";

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
 * One metric, following App Home's metrics-card composition: a quiet caption
 * with a tone icon, then the figure itself as the prominent heading. Tiles are
 * borderless — they sit inside a single section, so the section is the card and
 * the tiles never draw their own boxes. Tone colours only the icon, so colour
 * is never the only thing carrying the meaning.
 */
export function StatTile({
  label,
  value,
  icon,
  tone = "default",
  href,
  sub,
}: StatTileProps) {
  const content = (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-icon
          type={icon as never}
          tone={TONE_TO_ICON_TONE[tone]}
          size="base"
        />
        <s-text color="subdued">{label}</s-text>
      </s-stack>
      <s-heading>{value}</s-heading>
      {/* The sub-line rides as a neutral badge, not caption text, so each
        metric ends on a crisp grey pill. Colour is never spent here — the
        tone icon already carries the metric's signal, so a badge never
        dresses a plain descriptor up as a status. */}
      {sub && (
        <s-stack direction="inline">
          <s-badge tone="neutral">{sub}</s-badge>
        </s-stack>
      )}
    </s-stack>
  );

  if (href) {
    return (
      <s-clickable
        href={href}
        borderRadius="base"
        accessibilityLabel={`${label}: ${value}`}
      >
        {content}
      </s-clickable>
    );
  }

  return content;
}

export type Metric = StatTileProps;

/**
 * The App Home metrics-card composition: one section holding a row of
 * borderless StatTiles, each pair separated by a vertical divider. The grid
 * template interleaves a divider between every tile and collapses to a single
 * stacked column on a narrow container, so the dividers only ever sit between
 * side-by-side tiles rather than floating in a stack.
 */
export function MetricsCard({
  heading,
  description,
  metrics,
}: {
  heading?: string;
  description?: string;
  metrics: Metric[];
}) {
  // "1fr" for the first tile, then "auto 1fr" (divider + tile) for each of the
  // rest. Below the breakpoint the row stacks into one column.
  const columns = [
    "1fr",
    ...metrics.slice(1).flatMap(() => ["auto", "1fr"]),
  ].join(" ");

  return (
    <s-section heading={heading}>
      {description ? (
        <s-paragraph color="subdued">{description}</s-paragraph>
      ) : null}
      <s-grid
        gridTemplateColumns={`@container (inline-size <= 640px) 1fr, ${columns}`}
        gap="base"
        alignItems="stretch"
      >
        {metrics.map((metric, index) => (
          <Fragment key={metric.label}>
            {index > 0 ? <s-divider direction="block" /> : null}
            <StatTile {...metric} />
          </Fragment>
        ))}
      </s-grid>
    </s-section>
  );
}
