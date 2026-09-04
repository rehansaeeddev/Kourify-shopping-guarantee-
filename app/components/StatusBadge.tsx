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

export function StatusBadge({ status }: { status: string }) {
  return <s-badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</s-badge>;
}
