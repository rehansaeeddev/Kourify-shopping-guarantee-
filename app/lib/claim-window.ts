export type ClaimWindow = { minDays: number; maxDays: number };
export type ClaimWindows = Record<string, ClaimWindow>;

/*
 * The merchant's settings editor reads these when the stored blob is missing
 * or malformed. They mirror ClaimWindows::defaults() in the backend, which is
 * what actually enforces a window -- so if you change one, change both.
 *
 * Deliberately nothing else lives here. EVIDENCE_REQUIRED_TYPES and
 * CLAIM_ISSUE_TYPES used to, unused by anything, while the rule they restated
 * was enforced by IssueType in PHP and restated a third time in the shopper's
 * claim form. The form now takes it from the server; do not add it back.
 */
export const DEFAULT_CLAIM_WINDOWS: ClaimWindows = {
  lost: { minDays: 0, maxDays: 30 },
  damaged: { minDays: 0, maxDays: 7 },
  stolen: { minDays: 3, maxDays: 15 },
  shortage: { minDays: 0, maxDays: 7 },
  concealed: { minDays: 0, maxDays: 14 },
  wrong_item: { minDays: 0, maxDays: 14 },
};


export function parseClaimWindows(raw: string): ClaimWindows {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CLAIM_WINDOWS;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_CLAIM_WINDOWS;

  // Accept only well-formed { minDays, maxDays } number pairs. A malformed or
  // missing entry falls back to the default window rather than yielding
  // undefined bounds (which would silently disable window enforcement).
  const result: ClaimWindows = { ...DEFAULT_CLAIM_WINDOWS };
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const window = value as Partial<ClaimWindow> | null;
    if (
      window &&
      typeof window.minDays === "number" &&
      typeof window.maxDays === "number"
    ) {
      result[key] = { minDays: window.minDays, maxDays: window.maxDays };
    }
  }
  return result;
}
