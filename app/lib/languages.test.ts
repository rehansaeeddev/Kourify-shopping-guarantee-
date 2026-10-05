import { describe, expect, it } from "vitest";

import {
  LANGUAGE_CODES,
  languageChoices,
  merchantName,
  nativeName,
} from "./languages";

/**
 * The list a merchant picks from.
 *
 * It replaced a text field they had to type a locale code into, so the thing
 * worth pinning is that every code in it is one the backend will accept and
 * one that names itself -- a dropdown that offers a language the server then
 * refuses is worse than the text field was.
 */
describe("the language list", () => {
  it("offers each language once", () => {
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length);
  });

  /**
   * TranslationsController::store refuses anything outside this, and
   * Locale::normalize reduces to it before the row is written.
   */
  it("offers nothing the backend would refuse", () => {
    for (const code of LANGUAGE_CODES) {
      expect(code, code).toMatch(/^[a-z]{2,3}$/);
    }
  });

  /** The deprecated spellings browsers still answer to. */
  it("leaves out the old code for a language it already lists", () => {
    for (const [dead, alive] of [
      ["iw", "he"],
      ["in", "id"],
      ["ji", "yi"],
      ["mo", "ro"],
      ["sh", "sr"],
    ]) {
      expect(LANGUAGE_CODES).not.toContain(dead);
      expect(LANGUAGE_CODES).toContain(alive);
    }
  });

  it("includes every language the app ships finished", () => {
    for (const ready of ["en", "fr", "ar", "hi"]) {
      expect(LANGUAGE_CODES).toContain(ready);
    }
  });
});

describe("naming a language", () => {
  /** What a shopper sees in the switcher: the language's own word for itself. */
  it("gives a language its own name, capitalised", () => {
    expect(nativeName("ar")).toBe("العربية");
    expect(nativeName("hi")).toBe("हिन्दी");
    // "français" is correct prose and wrong for a menu item.
    expect(nativeName("fr")).toBe("Français");
    expect(nativeName("es")).toBe("Español");
  });

  /** What the merchant sees in the dropdown: their own word for it. */
  it("gives the merchant their own name for it", () => {
    expect(merchantName("ar", "en")).toBe("Arabic");
    expect(merchantName("de", "fr")).toBe("allemand");
  });

  /** A browser that cannot name a language must not drop it from the list. */
  it("falls back to the code rather than going blank", () => {
    expect(nativeName("zz")).toBe("zz");
    expect(merchantName("zz", "en")).toBe("zz");
  });
});

describe("the dropdown's contents", () => {
  it("leaves out languages already added", () => {
    const codes = languageChoices(["en"], ["en", "ar"]).map((c) => c.code);

    expect(codes).not.toContain("en");
    expect(codes).not.toContain("ar");
    expect(codes).toContain("fr");
  });

  /** The flag the warning is drawn from. */
  it("marks which ones arrive finished", () => {
    const choices = languageChoices(["en", "fr", "ar", "hi"], []);
    const ready = choices.filter((c) => c.translated).map((c) => c.code);

    expect(ready.sort()).toEqual(["ar", "en", "fr", "hi"]);
    expect(choices.find((c) => c.code === "ja")?.translated).toBe(false);
  });

  it("sorts by the merchant's own alphabet", () => {
    const labels = languageChoices([], [], "en").map((c) => c.label);

    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
  });
});
