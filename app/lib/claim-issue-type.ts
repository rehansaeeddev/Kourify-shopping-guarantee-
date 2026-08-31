export const ALL_ISSUE_TYPES = [
  { value: "lost", label: "Never arrived (lost in transit)" },
  { value: "damaged", label: "Arrived damaged" },
  { value: "stolen", label: "Marked delivered, not received (stolen)" },
  { value: "shortage", label: "Items missing from package" },
  { value: "concealed", label: "Box intact, contents damaged/missing" },
  { value: "wrong_item", label: "Wrong item received" },
] as const;

const ISSUE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ALL_ISSUE_TYPES.map((t) => [t.value, t.label]),
);

export function issueTypeLabel(issueType: string): string {
  return ISSUE_TYPE_LABEL[issueType] ?? issueType;
}
