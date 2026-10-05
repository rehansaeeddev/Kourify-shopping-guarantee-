/**
 * Every language a merchant can add the claim page in.
 *
 * The screen used to ask them to type a locale code into a text field. That
 * is how one shop ended up with a language it had named "English" saved under
 * the code `es`, a page of copy typed into it, and a claim page that went on
 * serving the shipped defaults. Nobody should have to know that `hi` is
 * Hindi.
 *
 * ISO 639-1, which is the set Shopify itself works in and the set
 * `Intl.DisplayNames` can name. The five deprecated codes browsers still
 * answer to are left out: `iw`, `in`, `ji`, `mo` and `sh` are the old
 * spellings of Hebrew, Indonesian, Yiddish, Romanian and Serbo-Croatian, and
 * offering a merchant both spellings of one language is offering them a way
 * to get it wrong.
 */
export const LANGUAGE_CODES: readonly string[] = [
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
  "ba", "be", "bg", "bi", "bm", "bn", "bo", "br", "bs",
  "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy",
  "da", "de", "dv", "dz",
  "ee", "el", "en", "eo", "es", "et", "eu",
  "fa", "ff", "fi", "fj", "fo", "fr", "fy",
  "ga", "gd", "gl", "gn", "gu", "gv",
  "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
  "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu",
  "ja", "jv",
  "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku",
  "kv", "kw", "ky",
  "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv",
  "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my",
  "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny",
  "oc", "oj", "om", "or", "os",
  "pa", "pi", "pl", "ps", "pt",
  "qu",
  "rm", "rn", "ro", "ru", "rw",
  "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sq",
  "sr", "ss", "st", "su", "sv", "sw",
  "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt",
  "tw", "ty",
  "ug", "uk", "ur", "uz",
  "ve", "vi", "vo",
  "wa", "wo",
  "xh",
  "yi", "yo",
  "za", "zh", "zu",
];

/**
 * Names a language, in whichever language was asked for.
 *
 * Returns null when the browser cannot do it, which is more often than it
 * sounds. Chrome ships CLDR's "modern" coverage, not the full set, so
 * `.of("aa")` comes back as "aa" rather than "Afar" -- and constructing
 * DisplayNames in a locale it has no data for quietly answers in English
 * instead of throwing. Node's full-icu knows all of them, which is why the
 * tests beside this file passed while the real dropdown showed rows reading
 * "aa — aa".
 */
function nameIn(language: string, inLocale: string): string | null {
  try {
    const named = new Intl.DisplayNames([inLocale], {
      type: "language",
      fallback: "code",
    }).of(language);

    // fallback: "code" means an unknown language answers with its own code.
    return named && named !== language ? named : null;
  } catch {
    return null;
  }
}

/** Upper-cases the first character by the rules of that language, not ours. */
function capitalize(text: string, locale: string): string {
  const first = [...text][0];

  return first === undefined
    ? text
    : first.toLocaleUpperCase(locale) + text.slice(first.length);
}

/**
 * What a shopper should see this language called: its own name for itself.
 *
 * `العربية`, not "Arabic". This goes in the claim page's language switcher,
 * where the person reading it is looking for their own language and will not
 * recognise the English word for it.
 *
 * Many come back lower-cased -- "français", "español" -- which is correct
 * prose and wrong for a menu item, so the first letter is raised. Where the
 * browser has no data for the language itself it answers in the merchant's
 * language instead, and that is what gets used: a name they can read beats no
 * name at all.
 */
export function nativeName(code: string, merchantLocale = "en"): string {
  const own = nameIn(code, code);

  return own !== null
    ? capitalize(own, code)
    : (nameIn(code, merchantLocale) ?? code);
}

/**
 * What the merchant should see it called, or null when the browser cannot
 * name it at all.
 *
 * Null is the signal to leave the language out of the list. A row reading
 * "aa — aa" helps nobody: a merchant cannot be expected to recognise a code,
 * and one who genuinely wants Afar is no better served by it.
 */
export function merchantName(code: string, merchantLocale = "en"): string | null {
  return nameIn(code, merchantLocale);
}

export type LanguageChoice = {
  code: string;
  /** Named in the merchant's language. */
  label: string;
  /** Named in its own language, for the shopper's switcher. */
  native: string;
  /** The dropdown row, already assembled. */
  display: string;
  /** Whether this app ships the page and the emails already written. */
  translated: boolean;
};

/**
 * The dropdown's contents: everything not already added, named and sorted.
 *
 * Three things this does that a plain map would not, all of them because the
 * browser's naming data is incomplete rather than wrong:
 *
 * A language the browser cannot name is dropped -- unless it is one we ship
 * translations for, which must never silently vanish from the list.
 *
 * "Albanian — Albanian" collapses to "Albanian". Where Chrome has no Albanian
 * data it answers in English, so the two halves come back identical and
 * printing both says nothing twice.
 *
 * Two codes that produce one name keep their codes. CLDR calls both `ak` and
 * `tw` "Akan", so the list showed Akan twice with no way to tell them apart;
 * now they read "Akan (ak)" and "Akan (tw)".
 *
 * Sorted with `localeCompare` in the merchant's own language, because
 * alphabetical order is a property of the language doing the sorting.
 */
export function languageChoices(
  translatedLocales: readonly string[],
  alreadyAdded: readonly string[],
  merchantLocale = "en",
): LanguageChoice[] {
  const taken = new Set(alreadyAdded);
  const ready = new Set(translatedLocales);

  const named = LANGUAGE_CODES.filter((code) => !taken.has(code))
    .map((code) => ({
      code,
      label: merchantName(code, merchantLocale),
      translated: ready.has(code),
    }))
    .filter(
      (language): language is { code: string; label: string; translated: boolean } =>
        language.label !== null || language.translated,
    )
    .map((language) => ({
      ...language,
      label: language.label ?? language.code,
    }));

  const seen = new Map<string, number>();
  for (const language of named) {
    seen.set(language.label, (seen.get(language.label) ?? 0) + 1);
  }

  return named
    .map(({ code, label, translated }) => {
      const native = nativeName(code, merchantLocale);
      const name = (seen.get(label) ?? 0) > 1 ? `${label} (${code})` : label;

      return {
        code,
        label: name,
        native,
        display: native === label ? name : `${name} — ${native}`,
        translated,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, merchantLocale));
}
