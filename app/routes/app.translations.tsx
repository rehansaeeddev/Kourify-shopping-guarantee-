import { useMemo, useRef, useState } from "react";

import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { InlineError, InlineLoading } from "../components/PageState";
import { useToast } from "../components/Toast";
import {
  DEFAULT_TRANSLATIONS,
  type TranslationStrings,
} from "../lib/claim-i18n";
import {
  useTranslationMutations,
  useTranslations,
  type Language,
} from "../lib/queries";
import { PageBody } from "../components/PageBody";

/** What every mutation here answers with. */
type Result = { ok: boolean; message?: string; error?: string | null };

/**
 * The languages list, add-language form and their modals.
 *
 * Split out of the route so the settings page can show it as one of its
 * panels. Everything here fits beside a settings rail; the per-language
 * editor does not, which is why editing is handed back to the caller
 * through onEdit rather than opened from in here.
 */
export function LanguagesPanel() {
  /*
   | Which language the editor is open on, if any. Held here rather than in
   | the URL so that this works the same wherever it is rendered -- the
   | settings panel has no route of its own to put a parameter on, and a list
   | that opened its editor in one place and navigated away in another was
   | the same control behaving two different ways.
   */
  const [editingLocale, setEditingLocale] = useState<string | null>(null);
  const { data, isPending, error, refetch } = useTranslations();
  const mutations = useTranslationMutations();
  const { showToast } = useToast();
  const [renaming, setRenaming] = useState<string | null>(null);

  // Removing a language drops its saved translations, so it's confirmed in a
  // native modal rather than a browser confirm() popup.
  const removeModalRef = useRef<{
    showOverlay: () => void;
    hideOverlay: () => void;
  } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{
    locale: string;
    label: string;
  } | null>(null);

  const cancelRemove = () => {
    setPendingRemove(null);
    removeModalRef.current?.hideOverlay();
  };

  /*
   * Every mutation on this page reports the same way: the backend's own
   * sentence on success, its own reason on failure. Passed per call rather
   * than baked into the hooks, because only this page wants a toast.
   */
  const notify = {
    onSuccess: (result: Result) => showToast(result.message ?? "Updated."),
    onError: (cause: Error) => showToast(cause.message, { isError: true }),
  };

  if (isPending) return <InlineLoading />;
  if (error)
    return <InlineError heading="Languages" error={error} onRetry={refetch} />;

  const { languages, keys } = data;
  const fallback = data.defaultLocale;

  const editing = editingLocale
    ? (languages.find((lang) => lang.locale === editingLocale) ?? null)
    : null;

  const renamingLang =
    languages.find((lang) => lang.locale === renaming) ?? null;

  const busy =
    mutations.add.isPending ||
    mutations.seed.isPending ||
    mutations.update.isPending ||
    mutations.remove.isPending ||
    mutations.setDefault.isPending ||
    mutations.saveStrings.isPending;

  const confirmRemove = () => {
    if (pendingRemove) mutations.remove.mutate(pendingRemove.locale, notify);
    setPendingRemove(null);
    removeModalRef.current?.hideOverlay();
  };

  if (editing) {
    return (
      <LanguageEditor
        editing={editing}
        keys={keys}
        referenceEn={DEFAULT_TRANSLATIONS.en}
        busy={mutations.saveStrings.isPending}
        onSave={(strings) =>
          mutations.saveStrings.mutate(
            { locale: editing.locale, strings },
            notify,
          )
        }
        onDone={() => setEditingLocale(null)}
      />
    );
  }

  return (
    <>
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
                loading={mutations.seed.isPending}
                disabled={busy}
                onClick={() => mutations.seed.mutate(undefined, notify)}
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
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);

                  mutations.update.mutate(
                    {
                      locale: renamingLang.locale,
                      label: String(form.get("label") ?? ""),
                      direction: String(form.get("direction") ?? "ltr"),
                    },
                    notify,
                  );
                  setRenaming(null);
                }}
              >
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
                    loading={mutations.update.isPending}
                    disabled={busy}
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
              </form>
            </Card>
          ) : null}

          {/* No heading: the settings rail already names this section, and
            a second "Languages" above the card only pushed it down out of
            line with the rail. The standalone route names it in its page
            heading. */}
          <Card>
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
                        {/* Every row repeats these five words, so on their
                              own they read as "Edit, Edit, Edit". The label
                              names the language; the visible text stays short. */}
                        <s-button
                          variant="secondary"
                          accessibilityLabel={`Edit ${lang.label}`}
                          onClick={() => setEditingLocale(lang.locale)}
                        >
                          Edit
                        </s-button>
                        <s-button
                          variant="secondary"
                          accessibilityLabel={`Rename ${lang.label}`}
                          onClick={() => setRenaming(lang.locale)}
                        >
                          Rename
                        </s-button>
                        <s-button
                          variant="secondary"
                          disabled={busy}
                          accessibilityLabel={`${lang.enabled ? "Hide" : "Show"} ${lang.label}`}
                          onClick={() =>
                            mutations.update.mutate(
                              { locale: lang.locale, enabled: !lang.enabled },
                              notify,
                            )
                          }
                        >
                          {lang.enabled ? "Hide" : "Show"}
                        </s-button>
                        {lang.locale !== fallback ? (
                          <s-button
                            variant="secondary"
                            disabled={busy}
                            accessibilityLabel={`Make ${lang.label} the default language`}
                            onClick={() =>
                              mutations.setDefault.mutate(lang.locale, notify)
                            }
                          >
                            Make default
                          </s-button>
                        ) : null}
                        {lang.locale !== fallback ? (
                          <s-button
                            variant="secondary"
                            disabled={busy}
                            accessibilityLabel={`Remove ${lang.label}`}
                            onClick={() => {
                              setPendingRemove({
                                locale: lang.locale,
                                label: lang.label,
                              });
                              removeModalRef.current?.showOverlay();
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

      <AddLanguage
        busy={busy}
        pending={mutations.add.isPending}
        onAdd={(language) => mutations.add.mutate(language, notify)}
      />

      <s-modal
        ref={removeModalRef as never}
        id="kourify-remove-language-modal"
        heading="Remove language"
      >
        <s-paragraph>
          {pendingRemove
            ? `Remove ${pendingRemove.label} from the claim page? Its saved translations are deleted, and shoppers will no longer see this language.`
            : ""}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={mutations.remove.isPending}
          disabled={busy}
          onClick={confirmRemove}
        >
          Remove
        </s-button>
        <s-button slot="secondary-actions" onClick={cancelRemove}>
          Cancel
        </s-button>
      </s-modal>
    </>
  );
}

/**
 * The page the app nav used to point at.
 *
 * Everything it shows is LanguagesPanel, which settings renders too. All this
 * adds is the page shell, so the two places stay the same screen rather than
 * two that drift.
 */
export default function Translations() {
  return (
    <s-page inlineSize="large" heading="Claim page languages">
      <s-button
        slot="secondary-actions"
        href="/app/settings"
        variant="secondary"
      >
        Back to settings
      </s-button>
      <PageBody>
        <LanguagesPanel />
      </PageBody>
    </s-page>
  );
}

function AddLanguage({
  busy,
  pending,
  onAdd,
}: {
  busy: boolean;
  pending: boolean;
  onAdd: (language: {
    locale: string;
    label: string;
    direction: string;
  }) => void;
}) {
  const [direction, setDirection] = useState("ltr");

  return (
    <Card heading="Add a language">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);

          onAdd({
            locale: String(form.get("locale") ?? "").trim(),
            label: String(form.get("label") ?? "").trim(),
            direction,
          });
          event.currentTarget.reset();
        }}
      >
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
              loading={pending}
              disabled={busy}
            >
              Add language
            </s-button>
          </s-grid>
        </s-stack>
      </form>
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

/** Matches the heading a Card draws for itself. */
const EDITOR_HEADING_SIZE = { size: "large-200" } as Record<string, string>;

function LanguageEditor({
  editing,
  keys,
  referenceEn,
  busy,
  onSave,
  onDone,
}: {
  editing: Language;
  keys: string[];
  referenceEn: TranslationStrings;
  busy: boolean;
  onSave: (strings: TranslationStrings) => void;
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
    <>
      {/* Uncontrolled on purpose: the fields are read off the form in one
          pass on submit, so typing in any of a few hundred inputs does not
          re-render the whole editor. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const strings: TranslationStrings = {};

          for (const [key, value] of form.entries()) {
            if (key.startsWith("s:")) strings[key.slice(2)] = String(value);
          }

          onSave(strings);
        }}
      >
        <Card boxed>
          {/* The way back and the name of what is open, inside the card
            rather than floating above it. Loose, they were the only things
            on the screen not sitting on a surface, and they pushed the card
            itself out of line with the rail. "Translations" went with them:
            "Edit <language>" already says what these rows are. */}
          <s-stack direction="inline" alignItems="center" gap="base">
            <s-button variant="secondary" icon="arrow-left" onClick={onDone}>
              Back to languages
            </s-button>
            <s-heading {...EDITOR_HEADING_SIZE}>
              {`Edit ${editing.label}`}
            </s-heading>
          </s-stack>
          <s-paragraph color="subdued">
            {`Blank fields fall back to English automatically.`}
          </s-paragraph>
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack
              direction="inline"
              gap="small-200"
              accessibilityLabel="String groups"
            >
              {groups.map((group) => {
                const groupKeys = buckets.get(group.id) ?? [];
                const remaining = groupKeys.filter(
                  (key) => !filled[key],
                ).length;
                return (
                  <s-button
                    key={group.id}
                    variant={tab === group.id ? "primary" : "secondary"}
                    // variant is styling; on its own it tells a screen
                    // reader nothing about which group is open.
                    accessibilityLabel={
                      tab === group.id
                        ? `${group.title}, current group`
                        : group.title
                    }
                    onClick={() => setTab(group.id)}
                  >
                    {remaining === 0
                      ? group.title
                      : `${group.title} (${remaining} left)`}
                  </s-button>
                );
              })}
            </s-stack>

            {/* Progress rides at the end of the tab row rather than above it,
                so the toolbar reads as one line: tabs on the left, how far
                along on the right. */}
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">Translated</s-text>
              <s-text type="strong" fontVariantNumeric="tabular-nums">
                {`${doneCount} of ${keys.length}`}
              </s-text>
              {doneCount === keys.length ? (
                <s-badge tone="success" icon="check">
                  Complete
                </s-badge>
              ) : (
                <s-badge tone="neutral">{`${pct}%`}</s-badge>
              )}
            </s-stack>
          </s-stack>

          {/* A hairline under the tab row frames it as a tab bar and puts clear
              air between the tabs and the first field, so the two never read as
              one cramped block. */}
          <s-divider direction="inline" />

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
                      {/* Key is identity, not status: a quiet label. The green
                          check is the only thing that carries "translated", so a
                          page of done strings reads as calm ticks rather than a
                          wall of colour. */}
                      <s-text type="strong">{key}</s-text>
                      {filled[key] ? (
                        <s-icon
                          type="check-circle"
                          tone="success"
                          size="base"
                        />
                      ) : null}
                      {/* s-icon takes no accessible name — Polaris treats
                            icons as decorative — so the state is said here
                            instead, visually hidden. Before this, "translated"
                            was carried by a green tick and nothing else. */}
                      <s-text accessibilityVisibility="exclusive">
                        {filled[key] ? "Translated" : "Not translated"}
                      </s-text>
                    </s-stack>
                    {/* Source on the left as read-only reference, the field to
                        translate on the right — the two-column shape of
                        Shopify's own translation editor. Stacks on a narrow
                        container. */}
                    <s-grid
                      gridTemplateColumns="@container (inline-size <= 640px) 1fr, 1fr 1fr"
                      gap="base"
                      alignItems="start"
                    >
                      <s-box
                        padding="base"
                        background="subdued"
                        borderRadius="base"
                      >
                        <s-text color="subdued">{referenceEn[key]}</s-text>
                      </s-box>
                      <s-text-field
                        label={key}
                        labelAccessibilityVisibility="exclusive"
                        name={`s:${key}`}
                        value={editing.strings[key] ?? ""}
                        placeholder={referenceEn[key]}
                        onInput={(event) => {
                          const value = (
                            event.currentTarget as HTMLInputElement
                          ).value;
                          setFilled((prev) =>
                            prev[key] === Boolean(value.trim())
                              ? prev
                              : { ...prev, [key]: Boolean(value.trim()) },
                          );
                        }}
                      />
                    </s-grid>
                  </s-stack>
                ))}
              </s-stack>
            </div>
          ))}

          <s-stack direction="inline" justifyContent="end">
            <s-button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={busy}
            >
              Save translations
            </s-button>
          </s-stack>
        </Card>
      </form>
    </>
  );
}
