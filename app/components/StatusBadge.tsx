const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  reviewing: "Reviewing",
  resolved: "Resolved",
  denied: "Denied",
};

const STATUS_TONE: Record<
  string,
  "critical" | "warning" | "success" | "neutral" | "info"
> = {
  submitted: "info",
  reviewing: "warning",
  resolved: "success",
  denied: "critical",
};

/**
 * Colour is never the only carrier.
 *
 * These badges are how a merchant scans a list of claims, and four tones of
 * pill are four identical shapes to anyone who cannot separate the colours —
 * or to anyone skimming. The icon says the same thing a second way.
 */
const STATUS_ICON: Record<string, string> = {
  submitted: "clock",
  reviewing: "in-progress",
  resolved: "check-circle",
  denied: "x-circle",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <s-badge
      tone={STATUS_TONE[status] ?? "neutral"}
      icon={(STATUS_ICON[status] ?? undefined) as never}
    >
      {STATUS_LABEL[status] ?? status}
    </s-badge>
  );
}
