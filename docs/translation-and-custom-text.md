# Translation and custom text: why it confuses merchants, and the plan

**Status:** proposal, not started.
**Written:** 2026-10-05, after a merchant hit three of these in one sitting.

The claim page can be translated and a merchant can add their own wording to
it. Both work. Neither is understandable, because the two live in different
screens, obey different rules, and start from an empty state the merchant has
to assemble by hand. This is the plan to make it one thing.

---

## What a merchant does today

To get a claim page in Arabic with their own notice on it, a merchant must:

1. Open **Settings → Branding**, scroll to **Your own text**, and type their
   notice into four boxes.
2. Open **Settings → Translations**, which says *"No languages yet"*, and
   press **Add English & French** — a button that adds two languages they may
   not want.
3. Press **Add a language** and type `ar` into a text field, by hand, plus a
   label.
4. Press **Edit**, and fill in a list of keys.
5. Discover their own notice is not in that list, because it is edited back in
   Branding.
6. See their English notice still showing on the Arabic page, and have no way
   to tell whether that is a bug or a fallback.

Every step there is something we could have done for them.

---

## The five causes

### 1. Custom text and translations are in different screens

The merchant's own blocks are edited in `app/components/BrandingPanel.tsx:576`
("Your own text"), inside the Branding tab. Everything else the page says is
edited in `app/routes/app.translations.tsx`. One page's wording, two screens,
no link between them.

### 2. We ask for languages Shopify already knows

`app/routes/app.translations.tsx:389` asks the merchant to type a raw locale
code. Meanwhile `shopLocales` appears nowhere in the backend — we never ask
Shopify which languages the shop actually publishes.

Verified against the 2026-10 Admin API:

```graphql
query KourifyShopLocales {
  shopLocales(published: true) { locale name primary published }
}
```

Valid. Needs `read_locales` (or `read_markets_home`), which the app does not
currently request.

### 3. The feature starts empty

`TranslationsController::seed()` creates rows for `SEED_LOCALES` only when the
merchant presses a button, and the empty state offers English and French as a
pair. We ship four complete language files — `lang/claim/{en,fr,ar,hi}.php`,
64 keys each, all in sync — and none of them reaches a shop until someone
clicks.

### 4. Three different fallback rules on one page

| Text | Rule |
|---|---|
| App copy | English master → that locale's file → merchant override |
| Custom text | that locale's copy → the default language's copy → nothing |
| The item step | no translation at all |

`ClaimTranslations::bundle()` documents the first two and explains why they
differ — the reasoning is sound, but no merchant can see it. The third is not
a rule, it is an omission (see below).

### 5. A counter with a hidden exception

`ClaimTranslations::untranslatableKeys()` removes the custom-text slots from
the "% complete" figure. Correct, and invisible. A merchant who notices the
count never reaches 100% has nothing on screen to explain it.

---

## The bug underneath all this

The item step — added with item-level coverage on 10 September — was never
translated. Thirteen strings are hardcoded English in
`resources/views/storefront/claim-form.blade.php`:

| Line | String |
|---|---|
| 76 | `Item` (progress label **and** its short form) |
| 101 | `Which item?` |
| 102 | `Choose the protected item affected, and how many units.` |
| 105 | `Item` (field label) |
| 106 | `Loading your order…` |
| 108 | `Units affected` |
| 167 | `Up to N unit(s) still claimable · MONEY each` |
| 171 | `Loading your order…`, `This order isn't protected.`, `There are no claimable items left on this order.` |
| 175 | `Choose which item was affected.`, `Enter how many units were affected.` |
| 176 | `Item` (review row) |

There is a second half to this that is easy to miss. Every other progress item
carries `data-i18n` and `data-i18n-short`:

```liquid
<div class="progress-item" data-progress="1" data-i18n="progress.contact"
     data-i18n-short="progress.contact.short" ...>{{ $t('progress.contact') }}</div>
```

The item step carries neither:

```liquid
<div class="progress-item" data-progress="2" data-short="Item">Item</div>
```

Those attributes are how the page re-translates itself when the shopper uses
the language switcher. So adding keys alone is not enough — without the
attributes the label would be right on first load and wrong after a switch.

---

## What it should be

One screen. The shop's own languages, already there. One fallback rule,
printed where the merchant can read it.

Concretely, a merchant should be able to open **Translations**, see their
store's published languages listed, click one, and edit every word on the
claim page — their own notice included — with each empty box saying what will
show instead.

---

## The plan

### Step 1 — Translate the item step

**Why first:** it is a bug, it is self-contained, and it ships without anyone
having to agree on anything.

- Add the missing keys to `lang/claim/{en,fr,ar,hi}.php`: `progress.item`,
  `progress.item.short`, `step.item.title`, `step.item.copy`, `item.label`,
  `item.loading`, `item.quantity.label`, `item.hint`, and four error keys.
- Replace the hardcoded strings in `claim-form.blade.php` with `$t(...)` and
  `tr(...)`.
- Add `data-i18n` / `data-i18n-short` to the item progress element.
- The hint on line 167 interpolates a count and a price, so its key needs
  placeholders rather than concatenation.

**Risk:** low. **Test:** load the claim page in Arabic, switch to English with
the picker, confirm the item step follows both times.

### Step 2 — Read the shop's languages from Shopify

- Add `read_locales` to `shopify.app.toml`.
- New backend call using the query above; expose it on the translations
  endpoint.
- Replace the hand-typed locale field with a picker of the shop's published
  languages, marking which is primary.
- Keep manual entry as a fallback for a language the shop has not published
  but wants on the claim page.

**WARNING:** adding a scope forces every merchant to re-authorise the app.
There is one install today, so the cost is nil now and rises with every new
one. If this is going to happen, it should happen before launch.

### Step 3 — Ship ready instead of empty

- On install, and on the first visit to Translations, create rows for the
  shop's published languages, filled from our shipped files.
- Delete the "No languages yet" empty state and the `Add English & French`
  button.
- Keep `seed()` for shops whose languages we cannot read.

**Risk:** low, and it removes the step most likely to be abandoned.

### Step 4 — One fallback rule

Make the custom-text slots resolve on the same chain as everything else, so
there is one sentence to explain instead of two.

**This one needs a decision.** The current split exists for a real reason,
written down in `ClaimTranslations::bundle()`: app copy falls back to the
English *we* wrote, which is always sensible; custom text has no shipped value
to fall back to, so falling back to "the default language's copy" is the only
option that does not print an empty box. Collapsing the rules means either:

- **(a)** custom text keeps its own chain, and we simply say so on screen —
  smallest change, rule stays two sentences; or
- **(b)** every key falls back to the default language's copy first, then the
  shipped English — one sentence, but it changes how app copy resolves for
  every existing shop.

I lean to **(a)**. The split is defensible; the invisibility is the problem.

### Step 5 — Put the custom text where the rest of the text is

- Move the four boxes out of Branding into the Translations editor, as the
  first section of each language.
- Branding keeps what it is for: layout, colour, logo, position.
- Under every empty box, print what will show instead — e.g. *"Empty → shows
  your English text"* — and show the same line for app copy.
- Show the "% complete" exception as a sentence, not a silent subtraction.

**Risk:** this is the largest change and touches a screen the merchant's boss
has already reviewed. It should be last, and it should be a design pass, not a
refactor done in passing.

---

## Order, and why

1 → 2 → 3 → 5, with 4 decided before 5 is built.

Step 1 is a bug and blocks nothing. Steps 2 and 3 together remove four of the
six manual steps a merchant does today, and they are cheap. Step 5 is the one
that needs design attention, and it is much easier to design once the empty
state and the hand-typed locale field are gone.

---

## Decisions needed

1. **Step 2's scope.** Add `read_locales` and accept one re-authorisation, or
   leave merchants typing locale codes by hand?
2. **Step 4.** Option (a) — keep the two rules and explain them — or option
   (b) — one rule for everything, changing how existing copy resolves?
3. **Step 5's home.** Custom text moves into Translations, or Translations
   grows a link into Branding?

---

## Deliberately not in this plan

- **Machine translation.** Offering to fill a language automatically is a
  different product decision and a running cost.
- **Per-market wording.** Shopify markets can publish the same language with
  different content. Out of scope until a merchant asks.
- **The storefront extension's own locales.** `extensions/kourify-badges/
  locales/*.json` is a separate, working mechanism; nothing here touches it.
