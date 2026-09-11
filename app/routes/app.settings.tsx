import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Card } from "../components/Card";
import { AppButton } from "../components/AppButton";
import { InfoTip } from "../components/InfoTip";
import { TrustBadgePreview } from "../components/TrustBadgePreview";
import { useFetcherToast } from "../hooks/useFetcherToast";
import { ALL_ISSUE_TYPES } from "../lib/claim-issue-type";
import {
  CLAIM_ISSUE_TYPES,
  DEFAULT_CLAIM_WINDOWS,
  parseClaimWindows,
  type ClaimWindows,
} from "../lib/claim-window";
import { syncProtectionProduct } from "../lib/protection-product.server";
import { getBillingState } from "../lib/billing-state.server";
import { detectPlanTier } from "../lib/plan-tier.server";
import { syncDynamicFee } from "../lib/cart-transform.server";
import { getProtectionQuota } from "../lib/plan-limits.server";
import {
  BASIC_PROTECTED_ORDER_LIMIT,
  planAllowsCustomerPays,
  planProtectedOrderLimit,
  type PlanId,
} from "../lib/plans";

/** Merchant-facing plan names, so copy never says "basic" in lowercase. */
const PLAN_LABELS: Record<PlanId, string> = {
  basic: "Basic",
  usage: "Usage",
  unlimited: "Unlimited",
  unlimited_annual: "Unlimited yearly",
};

// These persisted enums drive checkout/claim behaviour and (payer/feeType) the
// Cart Transform, so never store an arbitrary client-supplied string — only a
// value from the known set. Anything else falls back to the current setting.
const PROTECTION_PAYERS = ["customer", "merchant"] as const;
const PROTECTION_FEE_TYPES = ["flat", "percentage"] as const;

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
  { id: "general", label: "General" },
  { id: "pricing", label: "Pricing" },
  { id: "coverage", label: "Coverage" },
  { id: "claims", label: "Claims" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

const PROTECTION_STEPS = [
  "Customer selects protection",
  "Order is placed",
  "Customer submits a claim",
  "You review the claim",
  "You approve or deny the claim",
];

function pickEnum<T extends readonly string[]>(
  allowed: T,
  value: FormDataEntryValue | null,
  fallback: string,
): string {
  const candidate = String(value ?? "");
  return (allowed as readonly string[]).includes(candidate)
    ? candidate
    : fallback;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);

  const settings = await db.merchantSettings.upsert({
    where: { shop: session.shop },
    update: {},
    create: {
      shop: session.shop,
      claimWindows: JSON.stringify(DEFAULT_CLAIM_WINDOWS),
    },
  });

  const { activePlan } = await getBillingState(billing);
  const currentSettings =
    activePlan && settings.plan !== activePlan
      ? await db.merchantSettings.update({
          where: { shop: session.shop },
          data: { plan: activePlan },
        })
      : settings;
  const planTier = await detectPlanTier(admin, session.shop);
  const quota = await getProtectionQuota(session.shop, activePlan);
  return { settings: currentSettings, activePlan, planTier, quota };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const formData = await request.formData();

  // Storefront badge + guarantee-tab settings post here too, but they don't
  // touch checkout, so they take a cheap branch that skips the protection
  // product and Cart Transform sync the main save runs.
  if (formData.get("intent") === "badges") {
    const requestedBadgeStyle = String(formData.get("badgeStyle") ?? "classic");
    const badgeStyle = BADGE_STYLES.includes(
      requestedBadgeStyle as (typeof BADGE_STYLES)[number],
    )
      ? requestedBadgeStyle
      : "classic";
    const requestedTabPosition = String(
      formData.get("guaranteeTabPosition") ?? "right",
    );
    const guaranteeTabPosition = TAB_POSITIONS.some(
      (p) => p.value === requestedTabPosition,
    )
      ? requestedTabPosition
      : "right";
    const settings = await db.merchantSettings.update({
      where: { shop: session.shop },
      data: {
        badgesEnabled: formData.get("badgesEnabled") === "true",
        badgeStyle,
        showOnProduct: formData.get("showOnProduct") === "true",
        showOnCart: formData.get("showOnCart") === "true",
        guaranteeTabPosition,
      },
    });
    return { settings };
  }

  const current = await db.merchantSettings.findUniqueOrThrow({
    where: { shop: session.shop },
  });

  const { activePlan } = await getBillingState(billing);
  // Basic is a real (free) plan, so every shop can configure. This used to
  // gate on a paid subscription, which now only decides entitlements.
  const canConfigure = true;

  // Charging the customer at checkout cleanly (Cart Transform price override)
  // only works on Shopify Plus; on other plans it would surface as a separate
  // product line. So customer-pays is Plus-only — a known non-Plus store is
  // forced to merchant-pays server-side, regardless of what the form submits.
  // "unknown" fails open so a detection hiccup can't lock a real Plus store out.
  const planTier = await detectPlanTier(admin, session.shop);
  // Customer-pays needs both a Plus store (clean checkout pricing) and a plan
  // without a protected-order allowance — a capped plan can't promise the slot
  // will still exist when Shopify charges the shopper.
  const customerPaysAllowed =
    (planTier === "plus" || planTier === "unknown") &&
    planAllowsCustomerPays(activePlan);
  const requestedPayer = pickEnum(
    PROTECTION_PAYERS,
    formData.get("protectionPayer"),
    current.protectionPayer,
  );
  const protectionPayer = canConfigure
    ? customerPaysAllowed
      ? requestedPayer
      : "merchant"
    : current.protectionPayer;
  // Keep only recognised claim types, in canonical form, so an unknown/garbage
  // value can never reach the storefront claim form or downstream logic.
  const enabledClaimTypes = canConfigure
    ? String(formData.get("enabledClaimTypes") ?? "")
        .split(",")
        .map((type) => type.trim())
        .filter((type) => CLAIM_ISSUE_TYPES.includes(type))
        .join(",")
    : current.enabledClaimTypes;
  // Re-serialize through the validating parser (and clamp to non-negative,
  // whole days) rather than persisting the raw client JSON.
  const claimWindows = canConfigure
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(
            parseClaimWindows(String(formData.get("claimWindows") ?? "")),
          ).map(([type, window]) => [
            type,
            {
              minDays: Math.max(0, Math.round(window.minDays)),
              maxDays: Math.max(0, Math.round(window.maxDays)),
            },
          ]),
        ),
      )
    : current.claimWindows;
  const protectionFeeType = canConfigure
    ? pickEnum(
        PROTECTION_FEE_TYPES,
        formData.get("protectionFeeType"),
        current.protectionFeeType,
      )
    : current.protectionFeeType;
  const protectionFlatFeeCents = canConfigure
    ? Math.max(
        0,
        Math.round(Number(formData.get("protectionFlatFeeCents")) || 0),
      )
    : current.protectionFlatFeeCents;
  const protectionPercentBasisPoints = canConfigure
    ? Math.min(
        10000,
        Math.max(
          0,
          Math.round(Number(formData.get("protectionPercentBasisPoints")) || 0),
        ),
      )
    : current.protectionPercentBasisPoints;
  const protectionMinFeeCents = canConfigure
    ? Math.max(
        0,
        Math.round(Number(formData.get("protectionMinFeeCents")) || 0),
      )
    : current.protectionMinFeeCents;
  const protectionMaxFeeCents = canConfigure
    ? Math.max(
        protectionMinFeeCents,
        Math.round(Number(formData.get("protectionMaxFeeCents")) || 0),
      )
    : current.protectionMaxFeeCents;
  // Coverage eligibility ceiling. An empty field clears it back to "no ceiling"
  // rather than falling back to some implied amount — there is no default
  // monetary threshold anywhere in this app.
  const rawMaxEligible = formData.get("maxEligibleItemValueCents");
  const maxEligibleItemValueCents = canConfigure
    ? rawMaxEligible === null || String(rawMaxEligible).trim() === ""
      ? null
      : Math.max(0, Math.round(Number(rawMaxEligible) || 0)) || null
    : current.maxEligibleItemValueCents;
  // A plan whose protected-order allowance is spent can't have protection
  // switched on. Enforced here as well as in the UI so the toggle can't be
  // forced by a crafted request. The *stored* preference is left as-is, so
  // upgrading restores protection without the merchant re-enabling it.
  const quota = await getProtectionQuota(session.shop, activePlan);
  const requestedEnabled = canConfigure
    ? formData.get("protectionEnabled") === "true"
    : current.protectionEnabled;
  const protectionEnabled = quota.exhausted ? false : requestedEnabled;
  // `plan` decides whether the $0.60 per-order usage fee is waived and what
  // protected-order allowance applies, so it must never come from client
  // input — it's taken from the verified subscription state.
  const plan = activePlan;

  const settings = await db.merchantSettings.update({
    where: { shop: session.shop },
    data: {
      protectionPayer,
      enabledClaimTypes,
      claimWindows,
      protectionFeeType,
      protectionFlatFeeCents,
      protectionPercentBasisPoints,
      protectionMinFeeCents,
      protectionMaxFeeCents,
      maxEligibleItemValueCents,
      protectionEnabled,
      plan,
    },
  });

  // On merchant-pays the variant must cost nothing. The variant id is public
  // (the storefront needs it to add the line), so a shopper could POST it to
  // /cart/add.js themselves. Pricing it at 0 makes "the customer is never
  // charged on this payer mode" true by construction rather than by the
  // storefront choosing not to offer it.
  const effectiveVariantPriceCents =
    protectionPayer === "merchant" ? 0 : protectionFlatFeeCents;

  try {
    const productSettings =
      protectionEnabled &&
      (!current.protectionEnabled ||
        current.protectionFlatFeeCents !== protectionFlatFeeCents ||
        current.protectionPayer !== protectionPayer ||
        !current.protectionVariantId)
        ? await syncProtectionProduct(
            session.shop,
            admin,
            effectiveVariantPriceCents,
          )
        : settings;

    // Reconcile the Plus/dev percentage-fee Cart Transform. No-op on standard
    // plans or flat pricing; failures here must not break the settings save.
    // Reuses the planTier detected above.
    try {
      await syncDynamicFee(admin, productSettings, planTier);
    } catch (dynamicFeeError) {
      console.error("[protection] dynamic fee sync failed", dynamicFeeError);
    }

    return { settings: productSettings };
  } catch (error) {
    await db.merchantSettings.update({
      where: { shop: session.shop },
      data: { protectionEnabled: false },
    });
    return {
      settings: { ...settings, protectionEnabled: false },
      error:
        error instanceof Error
          ? error.message
          : "Could not configure the protection product.",
    };
  }
};

export default function Settings() {
  const { settings, planTier, quota, activePlan } =
    useLoaderData<typeof loader>();
  // Allowance spent → protection reads off and can't be switched on.
  const quotaExhausted = quota.exhausted;
  // Percentage pricing at checkout runs via a Cart Transform price override,
  // which only takes effect on Shopify Plus. Warn whenever we positively know
  // the store isn't Plus (skip "unknown" to avoid a false alarm).
  const percentageUnsupported =
    planTier !== "plus" &&
    planTier !== "unknown" &&
    settings.protectionFeeType === "percentage";
  // Customer-pays checkout pricing is Plus-only; hide it on known non-Plus.
  // Customer-pays needs both a Plus store (clean checkout pricing) and a plan
  // without a protected-order allowance — a capped plan can't promise the slot
  // will still exist when Shopify charges the shopper.
  const customerPaysAllowed =
    (planTier === "plus" || planTier === "unknown") &&
    planAllowsCustomerPays(activePlan);
  const settingsFetcher = useFetcher<{
    settings?: typeof settings;
    error?: string;
  }>();

  // Trust badge + guarantee tab save on their own fetcher so a badge change
  // never re-runs protection product sync or shows the protection toast.
  const badgeFetcher = useFetcher<{ settings?: typeof settings }>();

  // Each save names exactly what changed ("Flat fee set to $5.00", "Trust
  // badge turned on"), set just before the submit and read back by both the
  // toast and the top banner, so the merchant sees which setting was saved
  // rather than a generic "Settings saved."
  const pendingSettingsMessage = useRef("Settings saved.");
  const pendingBadgeMessage = useRef("Badge settings saved.");

  useFetcherToast(
    settingsFetcher,
    (data) => data.error ?? pendingSettingsMessage.current,
  );
  useFetcherToast(badgeFetcher, () => pendingBadgeMessage.current);

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const currentSettings = settingsFetcher.data?.settings ?? settings;
  const badgeState = badgeFetcher.data?.settings ?? currentSettings;

  // A dismissible success banner on top, alongside the toast, so a save is
  // confirmed both transiently and persistently. It's driven off the same
  // submitting→idle transition the toast watches (see useFetcherToast), so it
  // fires once per save, never on first load, and re-shows on the next save.
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const settingsWasSaving = useRef(false);
  const badgeWasSaving = useRef(false);

  useEffect(() => {
    if (settingsFetcher.state !== "idle") {
      settingsWasSaving.current = true;
      return;
    }
    if (
      settingsWasSaving.current &&
      settingsFetcher.data &&
      !settingsFetcher.data.error
    ) {
      setSavedNotice(pendingSettingsMessage.current);
    }
    settingsWasSaving.current = false;
  }, [settingsFetcher.state, settingsFetcher.data]);

  useEffect(() => {
    if (badgeFetcher.state !== "idle") {
      badgeWasSaving.current = true;
      return;
    }
    if (badgeWasSaving.current && badgeFetcher.data) {
      setSavedNotice(pendingBadgeMessage.current);
    }
    badgeWasSaving.current = false;
  }, [badgeFetcher.state, badgeFetcher.data]);

  const saveBadges = (overrides: {
    badgesEnabled?: boolean;
    badgeStyle?: string;
    showOnProduct?: boolean;
    showOnCart?: boolean;
    guaranteeTabPosition?: string;
  }) => {
    pendingBadgeMessage.current =
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
    badgeFetcher.submit(
      {
        intent: "badges",
        badgesEnabled: String(
          overrides.badgesEnabled ?? badgeState.badgesEnabled,
        ),
        badgeStyle: overrides.badgeStyle ?? badgeState.badgeStyle,
        showOnProduct: String(
          overrides.showOnProduct ?? badgeState.showOnProduct,
        ),
        showOnCart: String(overrides.showOnCart ?? badgeState.showOnCart),
        guaranteeTabPosition:
          overrides.guaranteeTabPosition ?? badgeState.guaranteeTabPosition,
      },
      { method: "POST" },
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
      plan?: string;
    },
    // Claim-reason and filing-window changes can't be described from the
    // override alone (it's a whole set/map), so those callers pass the message
    // in; everything else is a single field and describes itself.
    message?: string,
  ) => {
    const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    pendingSettingsMessage.current =
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
    const nextPayer =
      overrides.protectionPayer ?? currentSettings.protectionPayer;
    const nextTypes = overrides.enabledClaimTypes ?? enabledTypes;
    const nextWindows = overrides.claimWindows ?? claimWindows;
    settingsFetcher.submit(
      {
        protectionPayer: nextPayer,
        enabledClaimTypes: Array.from(nextTypes).join(","),
        claimWindows: JSON.stringify(nextWindows),
        protectionFeeType:
          overrides.protectionFeeType ?? currentSettings.protectionFeeType,
        protectionFlatFeeCents: String(
          overrides.protectionFlatFeeCents ??
            currentSettings.protectionFlatFeeCents,
        ),
        protectionPercentBasisPoints: String(
          overrides.protectionPercentBasisPoints ??
            currentSettings.protectionPercentBasisPoints,
        ),
        protectionMinFeeCents: String(
          overrides.protectionMinFeeCents ??
            currentSettings.protectionMinFeeCents,
        ),
        protectionMaxFeeCents: String(
          overrides.protectionMaxFeeCents ??
            currentSettings.protectionMaxFeeCents,
        ),
        maxEligibleItemValueCents: (() => {
          const next =
            overrides.maxEligibleItemValueCents !== undefined
              ? overrides.maxEligibleItemValueCents
              : currentSettings.maxEligibleItemValueCents;
          return next == null ? "" : String(next);
        })(),
        protectionEnabled: String(
          overrides.protectionEnabled ?? currentSettings.protectionEnabled,
        ),
        plan: overrides.plan ?? currentSettings.plan,
      },
      { method: "POST" },
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
    const next: ClaimWindows = {
      ...claimWindows,
      [type]: {
        minDays:
          field === "minDays" ? value : (claimWindows[type]?.minDays ?? 0),
        maxDays:
          field === "maxDays" ? value : (claimWindows[type]?.maxDays ?? 30),
      },
    };
    saveSettings(
      { claimWindows: next },
      `${label} filing window updated`,
    );
  };

  return (
    <s-page heading="Settings">
      <s-button slot="secondary-actions" href="/app/claims" variant="secondary">
        View claims
      </s-button>
      <s-button slot="secondary-actions" href="/app" variant="secondary">
        Back
      </s-button>

      {settingsFetcher.data?.error && (
        <s-banner tone="critical" heading="Protection could not be enabled">
          {settingsFetcher.data.error}
        </s-banner>
      )}

      {savedNotice && !settingsFetcher.data?.error && (
        <s-banner
          tone="success"
          dismissible
          onDismiss={() => setSavedNotice(null)}
        >
          {savedNotice}
        </s-banner>
      )}

      <s-box paddingBlockEnd="large">
        <s-stack
          direction="inline"
          gap="small-200"
          accessibilityLabel="Settings sections"
        >
          {SETTINGS_TABS.map((tab) => (
            <s-button
              key={tab.id}
              variant={tab.id === activeTab ? "primary" : "secondary"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </s-button>
          ))}
        </s-stack>
      </s-box>

      {activeTab === "general" && (
        <>
          <Card heading="Shopping Guarantee">
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
                checked={currentSettings.protectionEnabled && !quotaExhausted}
                disabled={quotaExhausted || settingsFetcher.state !== "idle"}
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
                  disabled={!badgeState.badgesEnabled}
                  onChange={(e) =>
                    saveBadges({ showOnProduct: e.currentTarget.checked })
                  }
                />
                <s-checkbox
                  label="Show in cart"
                  details="Display badge in cart and drawer"
                  checked={badgeState.showOnCart}
                  disabled={!badgeState.badgesEnabled}
                  onChange={(e) =>
                    saveBadges({ showOnCart: e.currentTarget.checked })
                  }
                />
              </s-stack>

              <s-stack direction="block" gap="base">
                <s-select
                  label="Badge style"
                  value={badgeState.badgeStyle}
                  disabled={!badgeState.badgesEnabled}
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
                  <s-text color="subdued">Preview — what shoppers see</s-text>
                  <s-box padding="base" border="base" borderRadius="base">
                    <TrustBadgePreview badgeStyle={badgeState.badgeStyle} />
                  </s-box>
                  <s-text color="subdued">
                    This is how your trust badge will appear on your store.
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
                The floating Kourify Guarantee tab shoppers use to learn about
                protection and file claims.
              </s-paragraph>
              <s-box minInlineSize="200px">
                <s-select
                  label="Tab position"
                  value={badgeState.guaranteeTabPosition}
                  onChange={(e) =>
                    saveBadges({ guaranteeTabPosition: e.currentTarget.value })
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
                guarantee right now — there&apos;s no real shipping-insurance
                underwriting behind it yet, so claims are reviewed manually
                rather than paid out automatically. Connect a real insurance
                partner (like EasyPost) before promising guaranteed payouts to
                customers.
              </InfoTip>
            </s-stack>

            <s-ordered-list>
              {PROTECTION_STEPS.map((step) => (
                <s-list-item key={step}>{step}</s-list-item>
              ))}
            </s-ordered-list>
            <s-banner tone="info">
              Claims are manually reviewed. Kourify doesn&apos;t automatically
              approve claims — you make the final decision and fund any
              settlement you approve.
            </s-banner>
          </Card>
        </>
      )}

      {activeTab === "pricing" && (
        <Card heading="Pricing">
          <s-paragraph>
            Who pays for protection, and — when the customer pays — how that fee
            is calculated.
          </s-paragraph>
          <s-stack direction="block" gap="base" paddingBlockStart="base">
            <s-choice-list
              label="Who pays for protection"
              labelAccessibilityVisibility="exclusive"
              name="protectionPayer"
              values={[merchantPays ? "merchant" : "customer"]}
              onChange={(event: { currentTarget: { values?: string[] } }) => {
                const next = event.currentTarget.values?.[0];
                if (next === "merchant" || next === "customer") {
                  saveSettings({ protectionPayer: next });
                }
              }}
            >
              <s-choice value="merchant">
                Merchant pays — protection is free for the customer and you
                cover the cost.
              </s-choice>
              <s-choice value="customer" disabled={!customerPaysAllowed}>
                {customerPaysAllowed
                  ? "Customer pays — the customer pays the protection fee at checkout."
                  : planAllowsCustomerPays(activePlan)
                    ? "Customer pays — requires Shopify Plus."
                    : "Customer pays — not available on this plan."}
              </s-choice>
            </s-choice-list>

            {!planAllowsCustomerPays(activePlan) && (
              <s-banner tone="info">
                {/* Plan name and limit are derived, not written in, so the
                      copy stays true if either changes. */}
                {`${PLAN_LABELS[activePlan]} includes up to ${
                  planProtectedOrderLimit(activePlan) ??
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
                    Percentage pricing only takes effect at checkout on Shopify
                    Plus. On your current plan customers are charged the flat
                    fee instead — switch to a flat fee so what they pay matches
                    what&apos;s shown, or cover it yourself with merchant-pays.
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
                        label="Flat fee per order"
                        labelAccessibilityVisibility="exclusive"
                        prefix="$"
                        min={0}
                        step={0.01}
                        value={(
                          currentSettings.protectionFlatFeeCents / 100
                        ).toFixed(2)}
                        onChange={(e) =>
                          saveSettings({
                            protectionFlatFeeCents:
                              Math.round(Number(e.currentTarget.value) * 100) ||
                              0,
                          })
                        }
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
                          label="Percentage"
                          labelAccessibilityVisibility="exclusive"
                          suffix="%"
                          min={0}
                          max={100}
                          step={0.1}
                          value={(
                            currentSettings.protectionPercentBasisPoints / 100
                          ).toFixed(1)}
                          onChange={(e) =>
                            saveSettings({
                              protectionPercentBasisPoints:
                                Math.round(
                                  Number(e.currentTarget.value) * 100,
                                ) || 0,
                            })
                          }
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
                          label="Minimum fee"
                          labelAccessibilityVisibility="exclusive"
                          prefix="$"
                          min={0}
                          step={0.01}
                          value={(
                            currentSettings.protectionMinFeeCents / 100
                          ).toFixed(2)}
                          onChange={(e) =>
                            saveSettings({
                              protectionMinFeeCents:
                                Math.round(
                                  Number(e.currentTarget.value) * 100,
                                ) || 0,
                            })
                          }
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
                          label="Maximum fee"
                          labelAccessibilityVisibility="exclusive"
                          prefix="$"
                          min={0}
                          step={0.01}
                          value={(
                            currentSettings.protectionMaxFeeCents / 100
                          ).toFixed(2)}
                          onChange={(e) =>
                            saveSettings({
                              protectionMaxFeeCents:
                                Math.round(
                                  Number(e.currentTarget.value) * 100,
                                ) || 0,
                            })
                          }
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
        <Card heading="Coverage eligibility">
          <s-paragraph>
            The most a single item can be worth and still be covered. Items
            priced above this are not protected and cannot be claimed. This is
            separate from what you charge for protection — the protection price
            is not the coverage amount.
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
                  Per item, before shipping and tax. Leave empty for no limit.
                </s-text>
              </s-stack>
              <s-box inlineSize="160px">
                <s-number-field
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
                    const raw = e.currentTarget.value;
                    saveSettings({
                      maxEligibleItemValueCents:
                        raw === "" || raw == null
                          ? null
                          : Math.round(Number(raw) * 100) || null,
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
                      <s-badge tone={row.eligible ? "success" : "neutral"}>
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
        <Card heading="Claim reasons & filing windows">
          <s-paragraph>
            Which reasons customers can choose in the storefront claim form, and
            how many days after an order ships each one can still be filed. We
            check this against the order&apos;s real fulfillment date — a claim
            outside its window is rejected automatically.
          </s-paragraph>
          {enabledTypes.size === 0 && (
            <s-banner tone="warning">
              Nothing&apos;s checked, so the storefront will fall back to
              showing all six reasons until you enable at least one here.
            </s-banner>
          )}
          <s-stack direction="block" gap="base" paddingBlockStart="base">
            {ALL_ISSUE_TYPES.map((type) => {
              const w = claimWindows[type.value] ?? { minDays: 0, maxDays: 30 };
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
                        disabled={!reasonEnabled}
                        value={String(w.minDays)}
                        onChange={(e) =>
                          updateWindow(
                            type.value,
                            "minDays",
                            Number(e.currentTarget.value) || 0,
                            type.label,
                          )
                        }
                      />
                    </s-box>
                    <s-text color="subdued">to</s-text>
                    <s-box inlineSize="90px">
                      <s-number-field
                        label="Max days"
                        labelAccessibilityVisibility="exclusive"
                        min={0}
                        disabled={!reasonEnabled}
                        value={String(w.maxDays)}
                        onChange={(e) =>
                          updateWindow(
                            type.value,
                            "maxDays",
                            Number(e.currentTarget.value) || 0,
                            type.label,
                          )
                        }
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
    </s-page>
  );
}
