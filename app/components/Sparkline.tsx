/**
 * A minimal inline trend line — no charting library. Values are plotted on
 * a shared scale (0 to the series max) so the line's shape is meaningful,
 * not normalized per-render.
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const stepX = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = height - (value / max) * (height - 4) - 2;
    return `${x},${y}`;
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Claims filed over the last 14 days"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={(values.length - 1) * stepX}
        cy={height - (values[values.length - 1]! / max) * (height - 4) - 2}
        r="2.5"
        fill="var(--color-accent)"
      />
    </svg>
  );
}
