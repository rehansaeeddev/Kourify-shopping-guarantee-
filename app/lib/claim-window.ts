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

export function parseClaimWindows(raw: string): ClaimWindows {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // fall through to default
  }
  return DEFAULT_CLAIM_WINDOWS;
}
