export type ClaimWindow = { minDays: number; maxDays: number };
export type ClaimWindows = Record<string, ClaimWindow>;

export const DEFAULT_CLAIM_WINDOWS: ClaimWindows = {
  lost: { minDays: 0, maxDays: 30 },
  damaged: { minDays: 0, maxDays: 7 },
  stolen: { minDays: 3, maxDays: 15 },
  shortage: { minDays: 0, maxDays: 7 },
  concealed: { minDays: 0, maxDays: 14 },
  wrong_item: { minDays: 0, maxDays: 14 },
};

export const EVIDENCE_REQUIRED_TYPES = ["damaged", "concealed"];
export const CLAIM_ISSUE_TYPES = Object.keys(DEFAULT_CLAIM_WINDOWS);

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
