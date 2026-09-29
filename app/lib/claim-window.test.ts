import { describe, expect, it } from "vitest";

import { DEFAULT_CLAIM_WINDOWS, parseClaimWindows } from "./claim-window";

describe("parseClaimWindows", () => {
  it("keeps the merchant's own windows", () => {
    const parsed = parseClaimWindows(
      JSON.stringify({ lost: { minDays: 2, maxDays: 45 } }),
    );

    expect(parsed.lost).toEqual({ minDays: 2, maxDays: 45 });
  });

  /**
   * The one that matters. An undefined bound is not a wide window, it is no
   * window at all — every late claim would pass the filing check.
   */
  it.each([
    ["not json at all", "{{{"],
    ["a json array", "[]"],
    ["a json string", '"lost"'],
    ["null", "null"],
    ["empty", ""],
  ])("falls back to the defaults for %s", (_label, raw) => {
    expect(parseClaimWindows(raw)).toEqual(DEFAULT_CLAIM_WINDOWS);
  });

  it("falls back per entry, not wholesale", () => {
    const parsed = parseClaimWindows(
      JSON.stringify({
        lost: { minDays: 1, maxDays: 60 },
        damaged: { minDays: "0", maxDays: 7 },
        stolen: null,
      }),
    );

    expect(parsed.lost).toEqual({ minDays: 1, maxDays: 60 });
    expect(parsed.damaged).toEqual(DEFAULT_CLAIM_WINDOWS.damaged);
    expect(parsed.stolen).toEqual(DEFAULT_CLAIM_WINDOWS.stolen);
  });

  it("does not mutate the defaults", () => {
    parseClaimWindows(JSON.stringify({ lost: { minDays: 9, maxDays: 9 } }));

    expect(DEFAULT_CLAIM_WINDOWS.lost).toEqual({ minDays: 0, maxDays: 30 });
  });
});
