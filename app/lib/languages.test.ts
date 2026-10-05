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

/**
 * These assert rules, not names.
 *
 * The first version of this file checked that nativeName("fr") was
 * "Français" -- and it passed, because vitest runs on Node's full ICU while
 * Chrome ships CLDR's reduced "modern" set. The real dropdown meanwhile had
 * rows reading "aa — aa", "Albanian — Albanian" and "Akan" twice. A test that
 * can only pass on the runner's data was no test of the browser at all.
 */
describe("naming a language", () => {
  it("gives a language its own name, capitalised", () => {
    const native = nativeName("fr");

    expect(native.length).toBeGreaterThan(1);
    expect(native[0]).toBe(native[0]?.toLocaleUpperCase("fr"));
  });

  it("names a language the merchant can read", () => {
    expect(merchantName("fr", "en")).toBe("French");
    expect(merchantName("ar", "en")).toBe("Arabic");
  });

  /** Null is the signal to leave it out, not a name to print. */
  it("returns null rather than a code the merchant cannot read", () => {
    expect(merchantName("zz", "en")).toBeNull();
  });

  /** A language with no name of its own still has to be callable something. */
  it("never leaves a shopper-facing name blank", () => {
    for (const code of LANGUAGE_CODES) {
      expect(nativeName(code).length, code).toBeGreaterThan(0);
    }
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

  /** The "aa — aa" rows. A code is not a name a merchant can act on. */
  it("offers nothing it cannot name", () => {
    for (const choice of languageChoices(["en", "fr", "ar", "hi"], [])) {
      expect(choice.display, choice.code).not.toBe(choice.code);
      expect(choice.display, choice.code).not.toBe(
        `${choice.code} — ${choice.code}`,
      );
    }
  });

  /**
   * A language we ship must never disappear, nameable or not.
   *
   * `cr` is the case that matters: Chrome cannot name Cree and would drop it,
   * Node can and would keep it anyway. Marked as shipped, both have to keep
   * it -- which is the rule, rather than whichever ICU the runner has.
   */
  it("keeps a translated language even if the browser cannot name it", () => {
    expect(languageChoices(["cr"], []).map((c) => c.code)).toContain("cr");
  });

  /** "Albanian — Albanian" said nothing twice. */
  it("prints one name when both names are the same", () => {
    for (const choice of languageChoices([], [])) {
      expect(choice.display, choice.code).not.toBe(
        `${choice.label} — ${choice.label}`,
      );
    }
  });

  /** CLDR calls both ak and tw "Akan", and the list showed Akan twice. */
  it("tells two languages apart when they share a name", () => {
    const choices = languageChoices([], []);
    const displays = choices.map((c) => c.display);

    expect(new Set(displays).size).toBe(displays.length);
  });
});
