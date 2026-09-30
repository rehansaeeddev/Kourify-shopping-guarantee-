import { useState } from "react";
import { useSearchParams } from "react-router";

import { AppButton } from "../components/AppButton";
import { BrandingPanel } from "../components/BrandingPanel";
import { Card } from "../components/Card";
import { LanguagesPanel } from "./app.translations";
import { InfoTip } from "../components/InfoTip";
import { PageError, PageSkeleton } from "../components/PageState";
import { TrustBadgePreview } from "../components/TrustBadgePreview";
import { useToast } from "../components/Toast";
import { ALL_ISSUE_TYPES } from "../lib/claim-issue-type";
import { parseClaimWindows, type ClaimWindows } from "../lib/claim-window";
import {
  BASIC_PROTECTED_ORDER_LIMIT,
  planAllowsCustomerPays,
  planProtectedOrderLimit,
  type PlanId,
} from "../lib/plans";
import { useSaveBadges, useSaveProtection, useSettings } from "../lib/queries";
import { PageBody } from "../components/PageBody";

/** Merchant-facing plan names, so copy never says "basic" in lowercase. */
const PLAN_LABELS: Record<PlanId, string> = {
  basic: "Basic",
  usage: "Usage",
  unlimited: "Unlimited",
  unlimited_annual: "Unlimited yearly",
};

// Storefront appearance, configured here in General so the merchant sets up
// protection and how it looks in one place. These drive the storefront badge
// and guarantee tab, not checkout, so they save on a separate cheap path.
const BADGE_STYLES = ["classic", "minimal", "bold"] as const;
const TAB_POSITIONS = [
  { value: "right", label: "Right edge (vertical)" },
  { value: "left", label: "Left edge (vertical)" },
  { value: "bottom", label: "Bottom corner" },
  { value: "top", label: "Top corner" },
] as const;

// Settings is configuration only — one tab per question a merchant asks:
// is it on, what does it cost and who pays, what's eligible, what can be
// claimed and when. Performance numbers live on the Dashboard.
const SETTINGS_TABS = [
  { id: "general", label: "General", icon: "settings" },
  { id: "pricing", label: "Pricing", icon: "cash-dollar" },
  { id: "coverage", label: "Coverage", icon: "shield-check-mark" },
  { id: "claims", label: "Claims", icon: "clipboard-checklist" },
  { id: "branding", label: "Branding", icon: "color" },
  { id: "languages", label: "Languages", icon: "globe" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

const PROTECTION_STEPS = [
  "Customer selects protection",
  "Order is placed",
  "Customer submits a claim",
  "You review the claim",
  "You approve or deny the claim",
];

export default function Settings() {
  const { data, isPending, error, refetch } = useSettings();
  // Badges save on their own endpoint so a badge change never re-runs the
  // protection product and Cart Transform reconciliation the main save does.
  const badges = useSaveBadges();
  const protection = useSaveProtection();
  const { showToast } = useToast();

  /*
   * The open tab lives in the URL, not in state.
   *
   * Held in state it was lost on every refresh: a merchant editing Branding
   * reloaded and landed back on General. It also means a tab can be linked
   * to and that the admin's own back button behaves.
   *
   * Replaced rather than pushed, so moving between tabs does not fill the
   * history with entries to walk back through -- back should leave Settings,
   * not retrace the tabs visited inside it.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");

  const activeTab: SettingsTab = SETTINGS_TABS.some((t) => t.id === requested)
    ? (requested as SettingsTab)
    : "general";

  const setActiveTab = (tab: SettingsTab) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("tab", tab);

        return next;
      },
      { replace: true },
    );

  // A dismissible banner on top, alongside the toast, so a save is confirmed
  // both transiently and persistently.
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  if (isPending) return <PageSkeleton heading="Settings" />;
  if (error)
    return <PageError heading="Settings" error={error} onRetry={refetch} />;

  const { settings, planTier, quota, activePlan, customerPaysAllowed } = data;

  // Allowance spent → protection reads off and can't be switched on.
  const quotaExhausted = quota.exhausted;

  // The backend answers with the saved row, so the page shows what was
  // actually stored — clamped values included — without waiting for the
  // refetch the mutation triggers.
  const currentSettings = protection.data?.settings ?? settings;
  const badgeState = badges.data?.settings ?? currentSettings;

  // Percentage pricing at checkout runs via a Cart Transform price override,
  // which only takes effect on Shopify Plus. Warn whenever we positively know
  // the store isn't Plus (skip "unknown" to avoid a false alarm).
  const percentageUnsupported =
    planTier !== "plus" &&
    planTier !== "unknown" &&
    // currentSettings, not settings: after switching the fee type the warning
    // has to follow the value just saved, not the one the page loaded with.
    currentSettings.protectionFeeType === "percentage";

  const plan = activePlan as PlanId;

  /**
   * Each save names exactly what changed — "Flat fee set to $5.00", "Trust
   * badge turned on" — rather than a generic "Settings saved.", so the
   * merchant can see which of a page of controls took effect.
   */
  const announce = (message: string) => {
    showToast(message);
    setSavedNotice(message);
  };

  const failed = (cause: Error) => showToast(cause.message, { isError: true });

  /**
   * A number the merchant typed, or null once it has said why it was ignored.
   *
   * s-number-field still hands back "", "e", "1e" and a lone "-", and every
   * one of those is NaN. The fields used to run it through
   * `Math.round(Number(v) * 100) || 0`, so clearing a fee to retype it saved
   * $0.00 on the way past — and the ceiling's `|| null` turned a typo into
   * "Coverage limit removed".
   */
  const numberFrom = (
    // Typed as optional by Polaris, and the old code ran Number(undefined)
    // straight into the same NaN as a mistyped one.
    raw: string | undefined,
    hint: string,
  ): number | null => {
    const value = Number(raw);

    if ((raw ?? "").trim() === "" || !Number.isFinite(value) || value < 0) {
      showToast(hint, { isError: true });

      return null;
    }

    return value;
  };

  const AMOUNT_HINT = "Enter an amount, like 4.99.";

  /*
   * Every save here sends the whole settings object, built from what was last
   * rendered. Two saves started before the first answers would each carry the
   * other's field at its old value, and the later one would quietly undo the
   * earlier — so a path holds its own controls while its save is in flight.
   */
  const savingProtection = protection.isPending;
  const savingBadges = badges.isPending;

  const saveBadges = (overrides: {
    badgesEnabled?: boolean;
    badgeStyle?: string;
    showOnProduct?: boolean;
    showOnCart?: boolean;
    guaranteeTabPosition?: string;
  }) => {
    const message =
      overrides.badgesEnabled !== undefined
        ? `Trust badge turned ${overrides.badgesEnabled ? "on" : "off"}`
        : overrides.showOnProduct !== undefined
          ? `Product-page badge ${overrides.showOnProduct ? "shown" : "hidden"}`
          : overrides.showOnCart !== undefined
            ? `Cart badge ${overrides.showOnCart ? "shown" : "hidden"}`
            : overrides.badgeStyle !== undefined
              ? `Badge style set to ${overrides.badgeStyle.charAt(0).toUpperCase()}${overrides.badgeStyle.slice(1)}`
              : overrides.guaranteeTabPosition !== undefined
                ? `Guarantee tab set to ${
                    TAB_POSITIONS.find(
                      (p) => p.value === overrides.guaranteeTabPosition,
                    )?.label ?? overrides.guaranteeTabPosition
                  }`
                : "Badge settings saved.";

    badges.mutate(
      {
        badgesEnabled: overrides.badgesEnabled ?? badgeState.badgesEnabled,
        badgeStyle: overrides.badgeStyle ?? badgeState.badgeStyle,
        showOnProduct: overrides.showOnProduct ?? badgeState.showOnProduct,
        showOnCart: overrides.showOnCart ?? badgeState.showOnCart,
        guaranteeTabPosition:
          overrides.guaranteeTabPosition ?? badgeState.guaranteeTabPosition,
      },
      { onSuccess: () => announce(message), onError: failed },
    );
  };

  // Worked example for the configured ceiling: one clearly under it, one
  // exactly on it (which passes), and one a dollar over (which doesn't).
  // Derived from the merchant's own number so no amount is ever implied.
  const eligibilityExample = (() => {
    const max = currentSettings.maxEligibleItemValueCents;
    if (max == null || max <= 0) return null;
    const under = Math.max(1, Math.round(max * 0.85));
    const over = max + 100;
    const label = (cents: number) =>
      `$${(cents / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    return [
      { label: label(under), eligible: true },
      { label: label(max), eligible: true },
      { label: label(over), eligible: false },
    ];
  })();
  const enabledTypes = new Set(
    (currentSettings.enabledClaimTypes ?? "").split(",").filter(Boolean),
  );
  const claimWindows = parseClaimWindows(currentSettings.claimWindows ?? "");
  const merchantPays = currentSettings.protectionPayer === "merchant";

  const saveSettings = (
    overrides: {
      protectionPayer?: string;
      enabledClaimTypes?: Set<string>;
      claimWindows?: ClaimWindows;
      protectionFeeType?: string;
      protectionFlatFeeCents?: number;
      protectionPercentBasisPoints?: number;
      protectionMinFeeCents?: number;
      protectionMaxFeeCents?: number;
      /** null clears the ceiling — no monetary default is substituted. */
      maxEligibleItemValueCents?: number | null;
      protectionEnabled?: boolean;
    },
    // Claim-reason and filing-window changes can't be described from the
    // override alone (it's a whole set/map), so those callers pass the message
    // in; everything else is a single field and describes itself.
    message?: string,
  ) => {
    const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const notice =
      message ??
      (overrides.protectionEnabled !== undefined
        ? `Protection at checkout turned ${overrides.protectionEnabled ? "on" : "off"}`
        : overrides.protectionPayer !== undefined
          ? `Who pays set to ${overrides.protectionPayer === "merchant" ? "Merchant pays" : "Customer pays"}`
          : overrides.protectionFeeType !== undefined
            ? `Fee structure set to ${overrides.protectionFeeType === "flat" ? "Flat fee per order" : "Percentage of order"}`
            : overrides.protectionFlatFeeCents !== undefined
              ? `Flat fee set to ${money(overrides.protectionFlatFeeCents)}`
              : overrides.protectionPercentBasisPoints !== undefined
                ? `Percentage set to ${(overrides.protectionPercentBasisPoints / 100).toFixed(1)}%`
                : overrides.protectionMinFeeCents !== undefined
                  ? `Minimum fee set to ${money(overrides.protectionMinFeeCents)}`
                  : overrides.protectionMaxFeeCents !== undefined
                    ? `Maximum fee set to ${money(overrides.protectionMaxFeeCents)}`
                    : overrides.maxEligibleItemValueCents !== undefined
                      ? overrides.maxEligibleItemValueCents == null
                        ? "Coverage limit removed"
                        : `Coverage limit set to ${money(overrides.maxEligibleItemValueCents)}`
                      : "Settings saved.");
    const nextTypes = overrides.enabledClaimTypes ?? enabledTypes;
    const nextWindows = overrides.claimWindows ?? claimWindows;
    const nextCeiling =
      overrides.maxEligibleItemValueCents !== undefined
        ? overrides.maxEligibleItemValueCents
        : currentSettings.maxEligibleItemValueCents;

    protection.mutate(
      {
        protectionPayer:
          overrides.protectionPayer ?? currentSettings.protectionPayer,
        enabledClaimTypes: Array.from(nextTypes).join(","),
        // A string, not an object: the backend re-parses it through the same
        // validating parser the storefront uses.
        claimWindows: JSON.stringify(nextWindows),
        protectionFeeType:
          overrides.protectionFeeType ?? currentSettings.protectionFeeType,
        protectionFlatFeeCents:
          overrides.protectionFlatFeeCents ??
          currentSettings.protectionFlatFeeCents,
        protectionPercentBasisPoints:
          overrides.protectionPercentBasisPoints ??
          currentSettings.protectionPercentBasisPoints,
        protectionMinFeeCents:
          overrides.protectionMinFeeCents ??
          currentSettings.protectionMinFeeCents,
        protectionMaxFeeCents:
          overrides.protectionMaxFeeCents ??
          currentSettings.protectionMaxFeeCents,
        // An empty string clears the ceiling; null would not survive the trip
        // as "the merchant cleared this" rather than "absent".
        maxEligibleItemValueCents: nextCeiling == null ? "" : nextCeiling,
        protectionEnabled:
          overrides.protectionEnabled ?? currentSettings.protectionEnabled,
      },
      {
        onSuccess: (result) => {
          /*
           * The settings themselves always save. A non-null error means
           * Shopify could not be brought in line — the protection product or
           * the Cart Transform — which is a different thing from a failed
           * write, and the banner below says so.
           */
          if (result.error) {
            showToast(result.error, { isError: true });
            return;
          }

          announce(notice);
        },
        onError: failed,
      },
    );
  };

  const toggleClaimType = (value: string, checked: boolean, label: string) => {
    const next = new Set(enabledTypes);
    if (checked) {
      next.add(value);
    } else {
      next.delete(value);
    }
    saveSettings(
      { enabledClaimTypes: next },
      `${label} claims ${checked ? "enabled" : "disabled"}`,
    );
  };

  const updateWindow = (
    type: string,
    field: "minDays" | "maxDays",
    value: number,
    label: string,
  ) => {
    const minDays =
      field === "minDays" ? value : (claimWindows[type]?.minDays ?? 0);
    const maxDays =
      field === "maxDays" ? value : (claimWindows[type]?.maxDays ?? 30);

    /*
     * The server refuses this too, and that is the real guard. It is caught
     * here so the message can say which end to move: widening 0–30 to 40–60
     * has to start with the last day, and a bare rejection would leave the
     * merchant retrying the first field.
     */
    if (minDays > maxDays) {
      showToast(
        field === "minDays"
          ? `The first day can't be later than the last (${maxDays}). Raise the last day first.`
          : `The last day can't be earlier than the first (${minDays}). Lower the first day first.`,
        { isError: true },
      );

      return;
    }

    const next: ClaimWindows = {
      ...claimWindows,
      [type]: { minDays, maxDays },
    };

    saveSettings({ claimWindows: next }, `${label} filing window updated`);
  };

  return (
    <s-page inlineSize="large" heading="Settings">
      <s-button slot="secondary-actions" href="/app/claims" variant="secondary">
        View claims
      </s-button>
      <s-button slot="secondary-actions" href="/app" variant="secondary">
        Back
      </s-button>
      <PageBody>
        {protection.data?.error && (
          <s-banner tone="critical" heading="Protection could not be enabled">
            {protection.data.error}
          </s-banner>
        )}

        {savedNotice && !protection.data?.error && (
          <s-banner
            tone="success"
            dismissible
            onDismiss={() => setSavedNotice(null)}
          >
            {savedNotice}
          </s-banner>
        )}

        {/* The sections read as a list of places, the way Shopify's own
          settings do, rather than a row of buttons that each look like an
          action. Below the breakpoint the rail becomes the first row and the
          panels stack under it. */}
        <s-grid
          /* No minmax() here: the conditional value is split on commas, so a
           comma inside a function swallows the whole definition and the grid
           silently collapses to one column. */
          gridTemplateColumns="@container (inline-size <= 700px) 1fr, 240px 1fr"
          gap="large"
          alignItems="start"
        >
          {/* large, matching the cards it sits beside -- at base the rail
            was visibly squarer than every panel to the right of it. */}
          <s-box
            padding="small-200"
            background="subdued"
            borderWidth="base"
            borderColor="strong"
            borderRadius="large"
          >
            <s-stack
              direction="block"
              gap="small-500"
              accessibilityLabel="Settings sections"
            >
              {SETTINGS_TABS.map((tab) => {
                const isActive = tab.id === activeTab;

                return (
                  <s-clickable
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    padding="small-300"
                    /* large, like the rail around it: at base the active
                      pill was the one square-cornered thing inside a
                      rounded box. */
                    borderRadius="large"
                    /*
                     * base on a subdued rail, which is the inverse of what
                     * this was. It read the other way round while the rail
                     * itself was white; once the rail took a surface of its
                     * own, a subdued pill on a subdued rail was no pill at
                     * all and every section looked current.
                     */
                    background={isActive ? "base" : "transparent"}
                    /*
                     * The outline, not the fill, is what says "this one".
                     * Polaris has three surface colours and they are #fff,
                     * #f7f7f7 and #f2f2f2 -- five shades apart at the widest
                     * -- so a white pill on a subdued rail is as far as
                     * background alone can carry this. Every item keeps a
                     * border so the row does not shift by a pixel when the
                     * current one changes; only its colour does.
                     */
                    borderWidth="base"
                    borderColor={isActive ? "strong" : "subdued"}
                    /* The current section is shown by a background and a bolder
                     label, and neither reaches a screen reader — both are
                     presentation. Saying it is the only way it carries. */
                    accessibilityLabel={
                      isActive ? `${tab.label}, current section` : tab.label
                    }
                  >
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <s-icon
                        type={tab.icon}
                        size="small"
                        tone={isActive ? undefined : "neutral"}
                      />
                      <s-text type={isActive ? "strong" : undefined}>
                        {tab.label}
                      </s-text>
                    </s-stack>
                  </s-clickable>
                );
              })}
            </s-stack>
          </s-box>

          <s-stack direction="block" gap="base">
            {activeTab === "general" && (
              <>
                <Card heading="Shopping Guarantee" boxed>
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="block" gap="small-200">
                      <s-stack
                        direction="inline"
                        gap="small-200"
                        alignItems="center"
                      >
                        <s-text>Protection at checkout</s-text>
                        <s-badge
                          tone={
                            quotaExhausted
                              ? "warning"
                              : currentSettings.protectionEnabled
                                ? "success"
                                : "neutral"
                          }
                        >
                          {quotaExhausted
                            ? "Limit reached"
                            : currentSettings.protectionEnabled
                              ? "On"
                              : "Off"}
                        </s-badge>
                      </s-stack>
                      <s-text color="subdued">
                        {quotaExhausted
                          ? "Switched off automatically — your plan's protected-order limit has been reached."
                          : currentSettings.protectionEnabled
                            ? "Customers can add protection to eligible orders at checkout."
                            : "Turn on to offer package protection at checkout."}
                      </s-text>
                    </s-stack>
                    <s-switch
                      label="Enable protection at checkout"
                      // Reads off, and can't be switched on, once the plan's
                      // allowance is spent. The saved preference is untouched, so
                      // upgrading brings protection straight back.
                      checked={
                        currentSettings.protectionEnabled && !quotaExhausted
                      }
                      disabled={quotaExhausted || savingProtection}
                      onChange={(e) =>
                        saveSettings({
                          protectionEnabled: e.currentTarget.checked,
                        })
                      }
                    />
                  </s-stack>

                  {quotaExhausted && (
                    <s-box paddingBlockStart="base">
                      <s-banner tone="warning">
                        {`You've used all ${quota.limit} protected orders on your plan, so protection is off and the storefront widget is hidden. Existing protected orders keep their coverage and can still be claimed. Upgrade from Billing to protect new orders again.`}
                      </s-banner>
                      <s-box paddingBlockStart="base">
                        <AppButton href="/app/billing" variant="primary">
                          View plans
                        </AppButton>
                      </s-box>
                    </s-box>
                  )}
                </Card>

                <Card heading="Trust badges">
                  <s-paragraph color="subdued">
                    Build confidence with a trust badge across your store.
                  </s-paragraph>
                  <s-grid
                    gridTemplateColumns="@container (inline-size <= 720px) 1fr, 1fr 1fr"
                    gap="large-100"
                    alignItems="start"
                  >
                    <s-stack direction="block" gap="base">
                      <s-switch
                        disabled={savingBadges}
                        label="Show trust badge on storefront"
                        details="Display on your store's theme"
                        checked={badgeState.badgesEnabled}
                        onChange={(e) =>
                          saveBadges({ badgesEnabled: e.currentTarget.checked })
                        }
                      />
                      <s-checkbox
                        label="Show on product pages"
                        details="Display badge on product pages"
                        checked={badgeState.showOnProduct}
                        disabled={savingBadges || !badgeState.badgesEnabled}
                        onChange={(e) =>
                          saveBadges({ showOnProduct: e.currentTarget.checked })
                        }
                      />
                      <s-checkbox
                        label="Show in cart"
                        details="Display badge in cart and drawer"
                        checked={badgeState.showOnCart}
                        disabled={savingBadges || !badgeState.badgesEnabled}
                        onChange={(e) =>
                          saveBadges({ showOnCart: e.currentTarget.checked })
                        }
                      />
                    </s-stack>

                    <s-stack direction="block" gap="base">
                      <s-select
                        label="Badge style"
                        value={badgeState.badgeStyle}
                        disabled={savingBadges || !badgeState.badgesEnabled}
                        onChange={(e) =>
                          saveBadges({ badgeStyle: e.currentTarget.value })
                        }
                      >
                        {BADGE_STYLES.map((style) => (
                          <s-option key={style} value={style}>
                            {style.charAt(0).toUpperCase() + style.slice(1)}
                          </s-option>
                        ))}
                      </s-select>

                      <s-stack direction="block" gap="small-200">
                        <s-text color="subdued">
                          Preview — what shoppers see
                        </s-text>
                        {/* The frame stays white on purpose — this shows the
                          badge as a shopper sees it on a product page, and
                          tinting behind it would change what is being
                          previewed. Only the edge is strengthened, so the
                          frame itself is visible. */}
                        <s-box
                          padding="base"
                          borderWidth="base"
                          borderColor="strong"
                          borderRadius="base"
                        >
                          <TrustBadgePreview
                            badgeStyle={badgeState.badgeStyle}
                          />
                        </s-box>
                        <s-text color="subdued">
                          This is how your trust badge will appear on your
                          store.
                        </s-text>
                      </s-stack>
                    </s-stack>
                  </s-grid>
                </Card>

                <Card heading="Guarantee tab">
                  <s-grid
                    gridTemplateColumns="1fr auto"
                    gap="base"
                    alignItems="center"
                  >
                    <s-paragraph>
                      The floating Kourify Guarantee tab shoppers use to learn
                      about protection and file claims.
                    </s-paragraph>
                    <s-box minInlineSize="200px">
                      <s-select
                        disabled={savingBadges}
                        label="Tab position"
                        value={badgeState.guaranteeTabPosition}
                        onChange={(e) =>
                          saveBadges({
                            guaranteeTabPosition: e.currentTarget.value,
                          })
                        }
                      >
                        {TAB_POSITIONS.map((pos) => (
                          <s-option key={pos.value} value={pos.value}>
                            {pos.label}
                          </s-option>
                        ))}
                      </s-select>
                    </s-box>
                  </s-grid>
                </Card>

                <Card heading="How protection works">
                  <s-stack direction="inline">
                    <InfoTip
                      id="tip-how-protection-works"
                      label="How protection works"
                    >
                      The &quot;Protect your order&quot; widget is live on your
                      product page and cart. It&apos;s an honest, self-funded
                      guarantee right now — there&apos;s no real
                      shipping-insurance underwriting behind it yet, so claims
                      are reviewed manually rather than paid out automatically.
                      Connect a real insurance partner (like EasyPost) before
                      promising guaranteed payouts to customers.
                    </InfoTip>
                  </s-stack>

                  <s-ordered-list>
                    {PROTECTION_STEPS.map((step) => (
                      <s-list-item key={step}>{step}</s-list-item>
                    ))}
                  </s-ordered-list>
                  <s-banner tone="info">
                    Claims are manually reviewed. Kourify doesn&apos;t
                    automatically approve claims — you make the final decision
                    and fund any settlement you approve.
                  </s-banner>
                </Card>
              </>
            )}

            {activeTab === "pricing" && (
              <Card heading="Pricing" boxed>
                <s-paragraph>
                  Who pays for protection, and — when the customer pays — how
                  that fee is calculated.
                </s-paragraph>
                <s-stack direction="block" gap="base" paddingBlockStart="base">
                  <s-choice-list
                    disabled={savingProtection}
                    label="Who pays for protection"
                    labelAccessibilityVisibility="exclusive"
                    name="protectionPayer"
                    values={[merchantPays ? "merchant" : "customer"]}
                    onChange={(event: {
                      currentTarget: { values?: string[] };
                    }) => {
                      const next = event.currentTarget.values?.[0];
                      if (next === "merchant" || next === "customer") {
                        saveSettings({ protectionPayer: next });
                      }
                    }}
                  >
                    <s-choice value="merchant">
                      Merchant pays — protection is free for the customer and
                      you cover the cost.
                    </s-choice>
                    <s-choice value="customer" disabled={!customerPaysAllowed}>
                      {customerPaysAllowed
                        ? "Customer pays — the customer pays the protection fee at checkout."
                        : planAllowsCustomerPays(plan)
                          ? "Customer pays — requires Shopify Plus."
                          : "Customer pays — not available on this plan."}
                    </s-choice>
                  </s-choice-list>

                  {!planAllowsCustomerPays(plan) && (
                    <s-banner tone="info">
                      {/* Plan name and limit are derived, not written in, so the
                      copy stays true if either changes. */}
                      {`${PLAN_LABELS[plan]} includes up to ${
                        planProtectedOrderLimit(plan) ??
                        BASIC_PROTECTED_ORDER_LIMIT
                      } protected orders. Protection is merchant-funded on this plan.`}
                    </s-banner>
                  )}

                  {merchantPays && (
                    <s-paragraph color="subdued">
                      {customerPaysAllowed
                        ? "There's no fee to set while you're covering protection. Switch to Customer pays to price it."
                        : "There's no fee to set: you're covering protection, and customer-paid protection isn't available on this store."}
                    </s-paragraph>
                  )}

                  {merchantPays ? null : (
                    <>
                      {percentageUnsupported && (
                        <s-banner tone="warning">
                          Percentage pricing only takes effect at checkout on
                          Shopify Plus. On your current plan customers are
                          charged the flat fee instead — switch to a flat fee so
                          what they pay matches what&apos;s shown, or cover it
                          yourself with merchant-pays.
                        </s-banner>
                      )}
                      <s-stack
                        direction="inline"
                        gap="base"
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <s-text>Fee structure</s-text>
                        <s-box inlineSize="220px">
                          <s-select
                            disabled={savingProtection}
                            label="Fee structure"
                            labelAccessibilityVisibility="exclusive"
                            value={currentSettings.protectionFeeType}
                            onChange={(e) =>
                              saveSettings({
                                protectionFeeType: e.currentTarget.value,
                              })
                            }
                          >
                            <s-option value="flat">Flat fee per order</s-option>
                            <s-option value="percentage">
                              Percentage of order
                            </s-option>
                          </s-select>
                        </s-box>
                      </s-stack>

                      {currentSettings.protectionFeeType === "flat" ? (
                        <s-stack
                          direction="inline"
                          gap="base"
                          alignItems="center"
                          justifyContent="space-between"
                        >
                          <s-stack direction="block" gap="small-100">
                            <s-text>Flat fee per order</s-text>
                            <s-text color="subdued">
                              Charged once per order, whatever the item count.
                            </s-text>
                          </s-stack>
                          <s-box inlineSize="140px">
                            <s-number-field
                              disabled={savingProtection}
                              label="Flat fee per order"
                              labelAccessibilityVisibility="exclusive"
                              prefix="$"
                              min={0}
                              step={0.01}
                              value={(
                                currentSettings.protectionFlatFeeCents / 100
                              ).toFixed(2)}
                              onChange={(e) => {
                                const amount = numberFrom(
                                  e.currentTarget.value,
                                  AMOUNT_HINT,
                                );
                                if (amount !== null)
                                  saveSettings({
                                    protectionFlatFeeCents: Math.round(
                                      amount * 100,
                                    ),
                                  });
                              }}
                            />
                          </s-box>
                        </s-stack>
                      ) : (
                        <>
                          <s-stack
                            direction="inline"
                            gap="base"
                            alignItems="center"
                            justifyContent="space-between"
                          >
                            <s-text>Percentage of order value</s-text>
                            <s-box inlineSize="140px">
                              <s-number-field
                                disabled={savingProtection}
                                label="Percentage"
                                labelAccessibilityVisibility="exclusive"
                                suffix="%"
                                min={0}
                                max={100}
                                step={0.1}
                                value={(
                                  currentSettings.protectionPercentBasisPoints /
                                  100
                                ).toFixed(1)}
                                onChange={(e) => {
                                  const percent = numberFrom(
                                    e.currentTarget.value,
                                    "Enter a percentage, like 2.5.",
                                  );
                                  if (percent !== null)
                                    saveSettings({
                                      protectionPercentBasisPoints: Math.round(
                                        percent * 100,
                                      ),
                                    });
                                }}
                              />
                            </s-box>
                          </s-stack>
                          <s-stack
                            direction="inline"
                            gap="base"
                            alignItems="center"
                            justifyContent="space-between"
                          >
                            <s-text>Minimum fee</s-text>
                            <s-box inlineSize="140px">
                              <s-number-field
                                disabled={savingProtection}
                                label="Minimum fee"
                                labelAccessibilityVisibility="exclusive"
                                prefix="$"
                                min={0}
                                step={0.01}
                                value={(
                                  currentSettings.protectionMinFeeCents / 100
                                ).toFixed(2)}
                                onChange={(e) => {
                                  const amount = numberFrom(
                                    e.currentTarget.value,
                                    AMOUNT_HINT,
                                  );
                                  if (amount !== null)
                                    saveSettings({
                                      protectionMinFeeCents: Math.round(
                                        amount * 100,
                                      ),
                                    });
                                }}
                              />
                            </s-box>
                          </s-stack>
                          <s-stack
                            direction="inline"
                            gap="base"
                            alignItems="center"
                            justifyContent="space-between"
                          >
                            <s-text>Maximum fee</s-text>
                            <s-box inlineSize="140px">
                              <s-number-field
                                disabled={savingProtection}
                                label="Maximum fee"
                                labelAccessibilityVisibility="exclusive"
                                prefix="$"
                                min={0}
                                step={0.01}
                                value={(
                                  currentSettings.protectionMaxFeeCents / 100
                                ).toFixed(2)}
                                onChange={(e) => {
                                  const amount = numberFrom(
                                    e.currentTarget.value,
                                    AMOUNT_HINT,
                                  );
                                  if (amount !== null)
                                    saveSettings({
                                      protectionMaxFeeCents: Math.round(
                                        amount * 100,
                                      ),
                                    });
                                }}
                              />
                            </s-box>
                          </s-stack>
                        </>
                      )}
                    </>
                  )}
                </s-stack>
              </Card>
            )}

            {activeTab === "coverage" && (
              <Card heading="Coverage eligibility" boxed>
                <s-paragraph>
                  The most a single item can be worth and still be covered.
                  Items priced above this are not protected and cannot be
                  claimed. This is separate from what you charge for protection
                  — the protection price is not the coverage amount.
                </s-paragraph>
                <s-stack direction="block" gap="base" paddingBlockStart="base">
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="block" gap="small-100">
                      <s-text>Maximum eligible item value</s-text>
                      <s-text color="subdued">
                        Per item, before shipping and tax. Leave empty for no
                        limit.
                      </s-text>
                    </s-stack>
                    <s-box inlineSize="160px">
                      <s-number-field
                        disabled={savingProtection}
                        label="Maximum eligible item value"
                        labelAccessibilityVisibility="exclusive"
                        prefix="$"
                        min={0}
                        step={0.01}
                        placeholder="No limit"
                        value={
                          currentSettings.maxEligibleItemValueCents == null
                            ? ""
                            : (
                                currentSettings.maxEligibleItemValueCents / 100
                              ).toFixed(2)
                        }
                        onChange={(e) => {
                          const raw = e.currentTarget.value ?? "";

                          // Clearing the field is the deliberate way to say
                          // "no ceiling", and the only one.
                          if (raw.trim() === "") {
                            saveSettings({ maxEligibleItemValueCents: null });

                            return;
                          }

                          const amount = numberFrom(
                            raw,
                            "Enter a limit, like 250.00, or clear the field for no limit.",
                          );

                          if (amount === null) return;

                          /*
                           * Zero used to clear the ceiling, because the
                           * backend reads any non-positive amount as "none".
                           * Typing 0 is not the same gesture as clearing the
                           * field, and reading it as "cover everything" is
                           * the opposite of what it looks like.
                           */
                          if (amount === 0) {
                            showToast(
                              "A limit of $0.00 would make every item ineligible. Clear the field for no limit.",
                              { isError: true },
                            );

                            return;
                          }

                          saveSettings({
                            maxEligibleItemValueCents: Math.round(amount * 100),
                          });
                        }}
                      />
                    </s-box>
                  </s-stack>

                  {eligibilityExample && (
                    <s-stack direction="block" gap="small-200">
                      <s-heading>Eligibility example</s-heading>
                      <s-stack direction="block" gap="small-300">
                        {eligibilityExample.map((row) => (
                          <s-stack
                            key={row.label}
                            direction="inline"
                            gap="small-200"
                            alignItems="center"
                            justifyContent="space-between"
                          >
                            <s-text>{row.label} item</s-text>
                            <s-badge
                              tone={row.eligible ? "success" : "neutral"}
                            >
                              {row.eligible ? "Eligible" : "Not eligible"}
                            </s-badge>
                          </s-stack>
                        ))}
                      </s-stack>
                    </s-stack>
                  )}

                  <s-banner tone="info">
                    {currentSettings.maxEligibleItemValueCents == null
                      ? "No limit set — every item on a protected order is eligible, whatever it costs."
                      : "This setting applies to new protected orders. Existing orders keep the eligibility recorded when they were paid."}
                  </s-banner>
                </s-stack>
              </Card>
            )}

            {activeTab === "claims" && (
              <Card heading="Claim reasons & filing windows" boxed>
                <s-paragraph>
                  Which reasons customers can choose in the storefront claim
                  form, and how many days after an order ships each one can
                  still be filed. We check this against the order&apos;s real
                  fulfillment date — a claim outside its window is rejected
                  automatically.
                </s-paragraph>
                {enabledTypes.size === 0 && (
                  <s-banner tone="warning">
                    Nothing&apos;s checked, so the storefront will fall back to
                    showing all six reasons until you enable at least one here.
                  </s-banner>
                )}
                <s-stack direction="block" gap="base" paddingBlockStart="base">
                  {ALL_ISSUE_TYPES.map((type) => {
                    const w = claimWindows[type.value] ?? {
                      minDays: 0,
                      maxDays: 30,
                    };
                    const reasonEnabled = enabledTypes.has(type.value);
                    return (
                      <s-stack
                        key={type.value}
                        direction="inline"
                        gap="base"
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <s-checkbox
                          disabled={savingProtection}
                          label={type.label}
                          checked={enabledTypes.has(type.value)}
                          onChange={(e) =>
                            toggleClaimType(
                              type.value,
                              e.currentTarget.checked ?? false,
                              type.label,
                            )
                          }
                        />
                        <s-stack
                          direction="inline"
                          gap="small-200"
                          alignItems="center"
                        >
                          <s-box inlineSize="90px">
                            <s-number-field
                              label="Min days"
                              labelAccessibilityVisibility="exclusive"
                              min={0}
                              disabled={savingProtection || !reasonEnabled}
                              value={String(w.minDays)}
                              onChange={(e) => {
                                const days = numberFrom(
                                  e.currentTarget.value,
                                  "Enter a number of days.",
                                );
                                if (days !== null)
                                  updateWindow(
                                    type.value,
                                    "minDays",
                                    Math.round(days),
                                    type.label,
                                  );
                              }}
                            />
                          </s-box>
                          <s-text color="subdued">to</s-text>
                          <s-box inlineSize="90px">
                            <s-number-field
                              label="Max days"
                              labelAccessibilityVisibility="exclusive"
                              min={0}
                              disabled={savingProtection || !reasonEnabled}
                              value={String(w.maxDays)}
                              onChange={(e) => {
                                const days = numberFrom(
                                  e.currentTarget.value,
                                  "Enter a number of days.",
                                );
                                if (days !== null)
                                  updateWindow(
                                    type.value,
                                    "maxDays",
                                    Math.round(days),
                                    type.label,
                                  );
                              }}
                            />
                          </s-box>
                          <s-text color="subdued">days</s-text>
                        </s-stack>
                      </s-stack>
                    );
                  })}
                </s-stack>
              </Card>
            )}

            {activeTab === "branding" && (
              <BrandingPanel settings={currentSettings} text={data.claimText} />
            )}

            {activeTab === "languages" && <LanguagesPanel />}
          </s-stack>
        </s-grid>
      </PageBody>
    </s-page>
  );
}
