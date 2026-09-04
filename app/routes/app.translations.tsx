import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";

import { AppButton } from "../components/AppButton";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
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
    if (parsed && typeof parsed === "object") return parsed as TranslationStrings;
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
      return { ok: true, message: `${label} added — translate its strings next.` };
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

    if (intent === "toggle") {
      const locale = normalizeLocale(String(form.get("locale") ?? ""));
      const enabled = form.get("enabled") === "true";
      await db.storefrontTranslation.update({
        where: { shop_locale: { shop, locale } },
        data: { enabled },
      });
      return { ok: true, message: enabled ? "Language enabled." : "Language hidden." };
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
  const fetcher = useFetcher<ActionResult>();
  useFetcherToast(fetcher, (data) => data.message ?? data.error ?? "Updated.");

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
    <s-page>
      <PageHeader
        title="Claim page languages"
        subtitle="Choose which languages the storefront claim page offers, and translate every label. Customers switch language with no page reload."
        actions={
          <AppButton href="/app/claims" variant="secondary">
            Back to claims
          </AppButton>
        }
      />

      {languages.length === 0 ? (
        <Card heading="Get started">
          <s-stack direction="block" gap="base">
            <EmptyState
              icon="globe"
              heading="No languages yet"
              description="Add English and French to match the current defaults, then add more languages like Arabic or Hindi."
            />
            <div>
              <AppButton
                variant="primary"
                disabled={fetcher.state !== "idle"}
                onClick={() =>
                  fetcher.submit({ intent: "seed_defaults" }, { method: "POST" })
                }
              >
                Add English &amp; French
              </AppButton>
            </div>
          </s-stack>
        </Card>
      ) : (
        <Card heading="Languages">
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Language</s-table-header>
              <s-table-header>Code</s-table-header>
              <s-table-header>Direction</s-table-header>
              <s-table-header>Visible</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {languages.map((lang) => (
                <s-table-row key={lang.locale}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-text>{lang.label}</s-text>
                      {lang.locale === fallback ? (
                        <s-badge tone="info">Default</s-badge>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{lang.locale}</s-table-cell>
                  <s-table-cell>{lang.direction.toUpperCase()}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={lang.enabled ? "success" : "warning"}>
                      {lang.enabled ? "Shown" : "Hidden"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <AppButton
                        variant="primary"
                        onClick={() =>
                          setSearchParams({ edit: lang.locale })
                        }
                      >
                        Edit
                      </AppButton>
                      <AppButton
                        variant="secondary"
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
                      </AppButton>
                      {lang.locale !== fallback ? (
                        <AppButton
                          variant="secondary"
                          disabled={fetcher.state !== "idle"}
                          onClick={() =>
                            fetcher.submit(
                              { intent: "set_default", locale: lang.locale },
                              { method: "POST" },
                            )
                          }
                        >
                          Make default
                        </AppButton>
                      ) : null}
                      {lang.locale !== fallback ? (
                        <AppButton
                          variant="secondary"
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
                        </AppButton>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </Card>
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
          <s-stack direction="inline" gap="base" alignItems="end">
            <div style={{ inlineSize: "120px", flex: "0 0 auto" }}>
              <s-text-field
                label="Language code"
                name="locale"
                placeholder="ar"
              />
            </div>
            <div style={{ inlineSize: "200px", flex: "0 0 auto" }}>
              <s-text-field
                label="Display name"
                name="label"
                placeholder="العربية"
              />
            </div>
            <div style={{ inlineSize: "160px", flex: "0 0 auto" }}>
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
            </div>
            <AppButton
              type="submit"
              variant="primary"
              disabled={fetcher.state !== "idle"}
            >
              Add language
            </AppButton>
          </s-stack>
        </s-stack>
      </fetcher.Form>
    </Card>
  );
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
  const [direction, setDirection] = useState(editing.direction);

  return (
    <s-page>
      <PageHeader
        title={`Edit ${editing.label}`}
        subtitle={`Translate each label for “${editing.locale}”. Blank fields fall back to English automatically.`}
        actions={
          <AppButton variant="secondary" onClick={onDone}>
            Back to languages
          </AppButton>
        }
      />

      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="locale" value={editing.locale} />
        <input type="hidden" name="direction" value={direction} />

        <Card heading="Language settings">
          <s-stack direction="block" gap="base">
            <div style={{ maxInlineSize: "320px" }}>
              <s-text-field
                label="Display name"
                name="label"
                value={editing.label}
              />
            </div>
            <div style={{ maxInlineSize: "220px" }}>
              <s-select
                label="Direction"
                value={direction}
                onChange={(event) =>
                  setDirection(event.currentTarget.value ?? editing.direction)
                }
              >
                <s-option value="ltr">Left to right</s-option>
                <s-option value="rtl">Right to left</s-option>
              </s-select>
            </div>
            <s-checkbox
              label="Show this language in the switcher"
              name="enabled"
              value="true"
              checked={editing.enabled}
            />
          </s-stack>
        </Card>

        <Card heading="Translations">
          <s-stack direction="block" gap="base">
            {keys.map((key) => (
              <s-stack key={key} direction="block" gap="small-100">
                <s-text color="subdued">
                  {key} — “{referenceEn[key]}”
                </s-text>
                <div style={{ maxInlineSize: "560px" }}>
                  <s-text-field
                    label={key}
                    labelAccessibilityVisibility="exclusive"
                    name={`s:${key}`}
                    value={editing.strings[key] ?? ""}
                    placeholder={referenceEn[key]}
                  />
                </div>
              </s-stack>
            ))}
            <div>
              <AppButton
                type="submit"
                variant="primary"
                disabled={fetcher.state !== "idle"}
              >
                Save translations
              </AppButton>
            </div>
          </s-stack>
        </Card>
      </fetcher.Form>
    </s-page>
  );
}
