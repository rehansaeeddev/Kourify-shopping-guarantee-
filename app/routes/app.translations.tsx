import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";

import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { useFetcherToast } from "../hooks/useFetcherToast";
import db from "../db.server";
import {
  CLAIM_KEYS,
  DEFAULT_TRANSLATIONS,
  LOCALE_LABELS,
  isRtl,
  normalizeLocale,
  type TranslationStrings,
} from "../lib/claim-i18n";
import { authenticate } from "../shopify.server";

type ActionResult = { ok: boolean; message?: string; error?: string };

function seedStrings(locale: string): TranslationStrings {
  // Seed only the locale's own template (Arabic, Hindi, …). Any key we don't
  // ship falls back to English at render time via the runtime merge, so we
  // never freeze English copy into the row — and shipped templates fill in
  // automatically without the merchant typing anything.
  return { ...(DEFAULT_TRANSLATIONS[locale] ?? {}) };
}

function parseStrings(raw: string): TranslationStrings {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object")
      return parsed as TranslationStrings;
  } catch {
    // fall through
  }
  return {};
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [rows, settings] = await Promise.all([
    db.storefrontTranslation.findMany({
      where: { shop: session.shop },
      orderBy: { locale: "asc" },
    }),
    db.merchantSettings.findUnique({ where: { shop: session.shop } }),
  ]);

  const languages = rows.map((row) => ({
    locale: row.locale,
    label: row.label,
    direction: row.direction,
    enabled: row.enabled,
    strings: parseStrings(row.strings),
  }));

  const editLocale = normalizeLocale(
    new URL(request.url).searchParams.get("edit") ?? "",
  );
  const editing = editLocale
    ? (languages.find((lang) => lang.locale === editLocale) ?? null)
    : null;

  return {
    languages,
    editing,
    fallback: normalizeLocale(settings?.storefrontFallbackLanguage ?? "en"),
    keys: CLAIM_KEYS,
    referenceEn: DEFAULT_TRANSLATIONS.en,
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "seed_defaults") {
      for (const locale of ["en", "fr"]) {
        await db.storefrontTranslation.upsert({
          where: { shop_locale: { shop, locale } },
          update: {},
          create: {
            shop,
            locale,
            label: LOCALE_LABELS[locale] ?? locale,
            direction: isRtl(locale) ? "rtl" : "ltr",
            enabled: true,
            strings: JSON.stringify(seedStrings(locale)),
          },
        });
      }
      return { ok: true, message: "English and French added." };
    }

    if (intent === "add") {
      const locale = normalizeLocale(String(form.get("locale") ?? "").trim());
      const label =
        String(form.get("label") ?? "").trim() ||
        LOCALE_LABELS[locale] ||
        locale;
      // Auto-force RTL for known RTL locales even if the dropdown said LTR.
      const direction =
        String(form.get("direction") ?? "") === "rtl" || isRtl(locale)
          ? "rtl"
          : "ltr";
      if (!/^[a-z]{2,3}$/.test(locale)) {
        return {
          ok: false,
          error: "Enter a valid language code (2–3 letters, e.g. ar, hi).",
        };
      }
      const existing = await db.storefrontTranslation.findUnique({
        where: { shop_locale: { shop, locale } },
      });
      if (existing) {
        return { ok: false, error: `${locale} is already added.` };
      }
      await db.storefrontTranslation.create({
        data: {
          shop,
          locale,
          label,
          direction,
          enabled: true,
          strings: JSON.stringify(seedStrings(locale)),
        },
      });
      return {
        ok: true,
        message: `${label} added — translate its strings next.`,
      };
    }

    if (intent === "save") {
      const locale = normalizeLocale(String(form.get("locale") ?? ""));
      const label = String(form.get("label") ?? "").trim() || locale;
      const direction =
        String(form.get("direction") ?? "") === "rtl" ? "rtl" : "ltr";
      const enabled = form.get("enabled") === "true";
      const strings: TranslationStrings = {};
      for (const [key, value] of form.entries()) {
        if (key.startsWith("s:")) strings[key.slice(2)] = String(value);
      }
      await db.storefrontTranslation.update({
        where: { shop_locale: { shop, locale } },
        data: {
          label,
          direction,
          enabled,
          strings: JSON.stringify(strings),
        },
      });
      return { ok: true, message: `${label} saved.` };
    }

    // Name and direction only. Deliberately separate from "save", which
    // rebuilds the whole `strings` blob from its form — running that from the
    // list, where no string fields exist, would wipe every translation.
    if (intent === "settings") {
      const locale = normalizeLocale(String(form.get("locale") ?? ""));
      const label = String(form.get("label") ?? "").trim() || locale;
      const direction =
        String(form.get("direction") ?? "") === "rtl" ? "rtl" : "ltr";
      await db.storefrontTranslation.update({
        where: { shop_locale: { shop, locale } },
        data: { label, direction },
      });
      return { ok: true, message: `${label} updated.` };
    }

    if (intent === "toggle") {
      const locale = normalizeLocale(String(form.get("locale") ?? ""));
      const enabled = form.get("enabled") === "true";
      await db.storefrontTranslation.update({
        where: { shop_locale: { shop, locale } },
        data: { enabled },
      });
      return {
        ok: true,
        message: enabled ? "Language enabled." : "Language hidden.",
      };
    }

    if (intent === "set_default") {
      const locale = normalizeLocale(String(form.get("locale") ?? ""));
      await db.merchantSettings.upsert({
        where: { shop },
        update: { storefrontFallbackLanguage: locale },
        create: {
          shop,
          storefrontFallbackLanguage: locale,
          claimWindows: "{}",
        },
      });
      return { ok: true, message: `Default language set to ${locale}.` };
    }

    if (intent === "remove") {
      const locale = normalizeLocale(String(form.get("locale") ?? ""));
      await db.storefrontTranslation
        .delete({ where: { shop_locale: { shop, locale } } })
        .catch(() => null);
      return { ok: true, message: `${locale} removed.` };
    }

    return { ok: false, error: "Unknown action." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
};

export default function Translations() {
  const { languages, editing, fallback, keys, referenceEn } =
    useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const [renaming, setRenaming] = useState<string | null>(null);
  const fetcher = useFetcher<ActionResult>();
  useFetcherToast(fetcher, (data) => data.message ?? data.error ?? "Updated.");

  const renamingLang =
    languages.find((lang) => lang.locale === renaming) ?? null;

  if (editing) {
    return (
      <LanguageEditor
        editing={editing}
        keys={keys}
        referenceEn={referenceEn}
        fetcher={fetcher}
        onDone={() => setSearchParams({})}
      />
    );
  }

  return (
    <s-page heading="Claim page languages">
      <s-button slot="secondary-actions" href="/app/claims" variant="secondary">
        Back to claims
      </s-button>

      {languages.length === 0 ? (
        <Card heading="Get started">
          <s-stack direction="block" gap="base">
            <EmptyState
              icon="globe"
              heading="No languages yet"
              description="Add English and French to match the current defaults, then add more languages like Arabic or Hindi."
            />
            <s-stack direction="inline">
              <s-button
                variant="primary"
                loading={fetcher.state !== "idle"}
                disabled={fetcher.state !== "idle"}
                onClick={() =>
                  fetcher.submit(
                    { intent: "seed_defaults" },
                    { method: "POST" },
                  )
                }
              >
                Add English &amp; French
              </s-button>
            </s-stack>
          </s-stack>
        </Card>
      ) : (
        <>
          {renamingLang ? (
            <Card heading={`Edit ${renamingLang.label}`}>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="settings" />
                <input
                  type="hidden"
                  name="locale"
                  value={renamingLang.locale}
                />
                <s-grid
                  gridTemplateColumns="1fr 1fr"
                  gap="base"
                  alignItems="end"
                >
                  <s-text-field
                    label="Display name"
                    name="label"
                    value={renamingLang.label}
                  />
                  <s-select
                    label="Direction"
                    name="direction"
                    value={renamingLang.direction}
                  >
                    <s-option value="ltr">Left to right</s-option>
                    <s-option value="rtl">Right to left</s-option>
                  </s-select>
                </s-grid>
                <s-stack direction="inline" gap="small-200">
                  <s-button
                    type="submit"
                    variant="primary"
                    loading={fetcher.state !== "idle"}
                    disabled={fetcher.state !== "idle"}
                    onClick={() => setRenaming(null)}
                  >
                    Save
                  </s-button>
                  <s-button
                    variant="secondary"
                    onClick={() => setRenaming(null)}
                  >
                    Cancel
                  </s-button>
                </s-stack>
              </fetcher.Form>
            </Card>
          ) : null}

          <Card heading="Languages">
            <s-paragraph color="subdued">
              Choose which languages the storefront claim page offers. Customers
              switch language with no page reload.
            </s-paragraph>
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Language</s-table-header>
                <s-table-header listSlot="secondary">Code</s-table-header>
                <s-table-header listSlot="labeled">Direction</s-table-header>
                <s-table-header listSlot="labeled">Visible</s-table-header>
                <s-table-header listSlot="inline">Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {languages.map((lang) => (
                  <s-table-row key={lang.locale}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-text type="strong">{lang.label}</s-text>
                        {lang.locale === fallback ? (
                          <s-badge tone="info">Default</s-badge>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{lang.locale}</s-table-cell>
                    <s-table-cell>{lang.direction.toUpperCase()}</s-table-cell>
                    <s-table-cell>
                      {/* A hidden language is an ordinary state, not a warning. */}
                      <s-badge tone={lang.enabled ? "success" : "neutral"}>
                        {lang.enabled ? "Shown" : "Hidden"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          variant="primary"
                          onClick={() => setSearchParams({ edit: lang.locale })}
                        >
                          Edit
                        </s-button>
                        <s-button
                          variant="secondary"
                          onClick={() => setRenaming(lang.locale)}
                        >
                          Rename
                        </s-button>
                        <s-button
                          variant="secondary"
                          loading={fetcher.state !== "idle"}
                          disabled={fetcher.state !== "idle"}
                          onClick={() =>
                            fetcher.submit(
                              {
                                intent: "toggle",
                                locale: lang.locale,
                                enabled: String(!lang.enabled),
                              },
                              { method: "POST" },
                            )
                          }
                        >
                          {lang.enabled ? "Hide" : "Show"}
                        </s-button>
                        {lang.locale !== fallback ? (
                          <s-button
                            variant="secondary"
                            loading={fetcher.state !== "idle"}
                            disabled={fetcher.state !== "idle"}
                            onClick={() =>
                              fetcher.submit(
                                { intent: "set_default", locale: lang.locale },
                                { method: "POST" },
                              )
                            }
                          >
                            Make default
                          </s-button>
                        ) : null}
                        {lang.locale !== fallback ? (
                          <s-button
                            variant="secondary"
                            loading={fetcher.state !== "idle"}
                            disabled={fetcher.state !== "idle"}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Remove ${lang.label} from the claim page?`,
                                )
                              ) {
                                fetcher.submit(
                                  { intent: "remove", locale: lang.locale },
                                  { method: "POST" },
                                );
                              }
                            }}
                          >
                            Remove
                          </s-button>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </Card>
        </>
      )}

      <AddLanguage fetcher={fetcher} />
    </s-page>
  );
}

function AddLanguage({
  fetcher,
}: {
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
}) {
  const [direction, setDirection] = useState("ltr");

  return (
    <Card heading="Add a language">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="add" />
        <input type="hidden" name="direction" value={direction} />
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Common codes: <s-text type="strong">ar</s-text> (Arabic, RTL),{" "}
            <s-text type="strong">hi</s-text> (Hindi),{" "}
            <s-text type="strong">es</s-text> (Spanish),{" "}
            <s-text type="strong">de</s-text> (German). New languages start
            seeded from English for you to translate.
          </s-paragraph>
          <s-grid
            gridTemplateColumns="1fr 1fr 1fr auto"
            gap="base"
            alignItems="end"
          >
            <s-text-field
              label="Language code"
              name="locale"
              placeholder="ar"
            />
            <s-text-field
              label="Display name"
              name="label"
              placeholder="العربية"
            />
            <s-select
              label="Direction"
              value={direction}
              onChange={(event) =>
                setDirection(event.currentTarget.value ?? "ltr")
              }
            >
              <s-option value="ltr">Left to right</s-option>
              <s-option value="rtl">Right to left</s-option>
            </s-select>
            <s-button
              type="submit"
              variant="primary"
              loading={fetcher.state !== "idle"}
              disabled={fetcher.state !== "idle"}
            >
              Add language
            </s-button>
          </s-grid>
        </s-stack>
      </fetcher.Form>
    </Card>
  );
}

/**
 * Tabs for the translation editor.
 *
 * Order matters — first match wins — and the last entry has no prefixes, so
 * it catches anything the others miss. That catch-all is load-bearing: the
 * save action rebuilds `strings` from the submitted form alone, so a key that
 * fell out of every group would be deleted the next time the form is saved.
 */
const TRANSLATION_GROUPS: {
  id: string;
  title: string;
  prefixes: string[];
}[] = [
  {
    id: "landing",
    title: "Landing",
    prefixes: ["hero.", "promise.", "panel."],
  },
  { id: "form", title: "Form", prefixes: ["progress.", "step.", "field."] },
  { id: "issues", title: "Issue types", prefixes: ["issue."] },
  {
    id: "review",
    title: "Review & actions",
    prefixes: ["review.", "notice", "legal", "action."],
  },
  {
    id: "messages",
    title: "Messages",
    prefixes: ["error.", "state.", "success."],
  },
  { id: "general", title: "General", prefixes: [] },
];

function groupTranslationKeys(keys: string[]): Map<string, string[]> {
  const buckets = new Map(
    TRANSLATION_GROUPS.map((g) => [g.id, [] as string[]]),
  );
  const fallback = TRANSLATION_GROUPS[TRANSLATION_GROUPS.length - 1].id;

  for (const key of keys) {
    const group = TRANSLATION_GROUPS.find(
      (g) => g.prefixes.length > 0 && g.prefixes.some((p) => key.startsWith(p)),
    );
    buckets.get(group?.id ?? fallback)!.push(key);
  }
  return buckets;
}

function LanguageEditor({
  editing,
  keys,
  referenceEn,
  fetcher,
  onDone,
}: {
  editing: {
    locale: string;
    label: string;
    direction: string;
    enabled: boolean;
    strings: TranslationStrings;
  };
  keys: string[];
  referenceEn: TranslationStrings;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  onDone: () => void;
}) {
  // Which strings are filled in. Seeded from what's saved, then kept live as
  // the merchant types so the counts and the progress bar mean something.
  const [filled, setFilled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      keys.map((key) => [key, Boolean(editing.strings[key]?.trim())]),
    ),
  );

  const buckets = useMemo(() => groupTranslationKeys(keys), [keys]);
  const groups = TRANSLATION_GROUPS.filter(
    (g) => (buckets.get(g.id)?.length ?? 0) > 0,
  );
  const [tab, setTab] = useState(groups[0]?.id ?? "general");

  const doneCount = keys.filter((key) => filled[key]).length;
  const pct = keys.length ? Math.round((doneCount / keys.length) * 100) : 0;

  return (
    <s-page heading={`Edit ${editing.label}`}>
      <s-button slot="secondary-actions" variant="secondary" onClick={onDone}>
        Back to languages
      </s-button>

      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="locale" value={editing.locale} />
        {/* None of these are editable here — they live on the languages list,
            which is where languages are managed. They still have to ride along
            with the form: the save action rebuilds the row from what it
            receives, so dropping them would rename the language to its bare
            locale code and quietly hide it from the switcher. */}
        <input type="hidden" name="label" value={editing.label} />
        <input type="hidden" name="direction" value={editing.direction} />
        <input type="hidden" name="enabled" value={String(editing.enabled)} />

        <Card heading="Translations">
          <s-paragraph color="subdued">
            {`Blank fields fall back to English automatically.`}
          </s-paragraph>
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text color="subdued">Translated</s-text>
            <s-text type="strong" fontVariantNumeric="tabular-nums">
              {`${doneCount} of ${keys.length}`}
            </s-text>
            {doneCount === keys.length && (
              <s-badge tone="success">Complete</s-badge>
            )}
          </s-stack>

          <s-stack
            direction="inline"
            gap="small-200"
            accessibilityLabel="String groups"
          >
            {groups.map((group) => {
              const groupKeys = buckets.get(group.id) ?? [];
              const remaining = groupKeys.filter((key) => !filled[key]).length;
              return (
                <s-button
                  key={group.id}
                  variant={tab === group.id ? "primary" : "tertiary"}
                  onClick={() => setTab(group.id)}
                >
                  {remaining === 0
                    ? group.title
                    : `${group.title} (${remaining} left)`}
                </s-button>
              );
            })}
          </s-stack>

          {/* A bare <div hidden> rather than an s-box: the panels must stay in
              the DOM whichever tab is open, because the save action rebuilds
              the whole `strings` blob from the submitted form and would delete
              anything missing. Polaris sets its own display on s-box, which
              would defeat the hidden attribute. No class, no CSS — this is
              visibility, not layout. */}
          {groups.map((group) => (
            <div key={group.id} hidden={tab !== group.id}>
              <s-stack direction="block" gap="base">
                {(buckets.get(group.id) ?? []).map((key) => (
                  <s-stack key={key} direction="block" gap="small-300">
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <s-badge tone={filled[key] ? "success" : "neutral"}>
                        {key}
                      </s-badge>
                      <s-text color="subdued">{referenceEn[key]}</s-text>
                    </s-stack>
                    <s-text-field
                      label={key}
                      labelAccessibilityVisibility="exclusive"
                      name={`s:${key}`}
                      value={editing.strings[key] ?? ""}
                      placeholder={referenceEn[key]}
                      onInput={(event) => {
                        const value = (event.currentTarget as HTMLInputElement)
                          .value;
                        setFilled((prev) =>
                          prev[key] === Boolean(value.trim())
                            ? prev
                            : { ...prev, [key]: Boolean(value.trim()) },
                        );
                      }}
                    />
                  </s-stack>
                ))}
              </s-stack>
            </div>
          ))}

          <s-stack direction="inline" justifyContent="end">
            <s-button
              type="submit"
              variant="primary"
              loading={fetcher.state !== "idle"}
              disabled={fetcher.state !== "idle"}
            >
              Save translations
            </s-button>
          </s-stack>
        </Card>
      </fetcher.Form>
    </s-page>
  );
}
