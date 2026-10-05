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
 * Wrapped because `Intl.DisplayNames` throws on a locale tag it cannot parse
 * and returns the code unchanged for one it does not know -- and this runs in
 * whatever browser the merchant brought. A language that cannot be named is
 * still offered, under its code, rather than disappearing from the list.
 */
function nameIn(language: string, inLocale: string): string | null {
  try {
    const named = new Intl.DisplayNames([inLocale], {
      type: "language",
      fallback: "code",
    }).of(language);

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
 * Many of these come back lower-cased -- "français", "español" -- which is
 * correct prose and wrong for a menu item, so the first letter is raised.
 * A language that cannot name itself falls back to the merchant's name for
 * it, and then to the code.
 */
export function nativeName(code: string, merchantLocale = "en"): string {
  const own = nameIn(code, code);

  return own !== null
    ? capitalize(own, code)
    : (nameIn(code, merchantLocale) ?? code);
}

/** What the merchant should see it called: their own name for the language. */
export function merchantName(code: string, merchantLocale = "en"): string {
  return nameIn(code, merchantLocale) ?? code;
}

export type LanguageChoice = {
  code: string;
  /** Named in the merchant's language, for the dropdown. */
  label: string;
  /** Named in its own language, for the shopper's switcher. */
  native: string;
  /** Whether this app ships the page and the emails already written. */
  translated: boolean;
};

/**
 * The dropdown's contents: everything not already added, named and sorted.
 *
 * Sorted with `localeCompare` in the merchant's own language, because
 * alphabetical order is a property of the language doing the sorting -- and
 * a merchant reading a Spanish admin expects ñ where Spanish puts it.
 */
export function languageChoices(
  translatedLocales: readonly string[],
  alreadyAdded: readonly string[],
  merchantLocale = "en",
): LanguageChoice[] {
  const taken = new Set(alreadyAdded);
  const ready = new Set(translatedLocales);

  return LANGUAGE_CODES.filter((code) => !taken.has(code))
    .map((code) => ({
      code,
      label: merchantName(code, merchantLocale),
      native: nativeName(code, merchantLocale),
      translated: ready.has(code),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, merchantLocale));
}
