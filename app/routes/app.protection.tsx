import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PageHeader } from "../components/PageHeader";
import { Card, StatTile } from "../components/Card";
import { AppButton } from "../components/AppButton";
import { BillingStatusCard } from "../components/BillingStatusCard";
import { useFetcherToast } from "../hooks/useFetcherToast";
import { ALL_ISSUE_TYPES } from "../lib/claim-issue-type";
import {
  CLAIM_ISSUE_TYPES,
  DEFAULT_CLAIM_WINDOWS,
  parseClaimWindows,
  type ClaimWindows,
} from "../lib/claim-window";
import { syncProtectionProduct } from "../lib/protection-product.server";
import { getProtectionAnalytics } from "../lib/protection-orders.server";
import { getBillingState } from "../lib/billing-state.server";
import { detectPlanTier } from "../lib/plan-tier.server";
import { syncDynamicFee } from "../lib/cart-transform.server";

// These persisted enums drive checkout/claim behaviour and (payer/feeType) the
// Cart Transform, so never store an arbitrary client-supplied string — only a
// value from the known set. Anything else falls back to the current setting.
const PROTECTION_PAYERS = ["customer", "merchant"] as const;
const PROTECTION_FEE_TYPES = ["flat", "percentage"] as const;

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

  const { hasActiveBilling, activePlan } = await getBillingState(billing);
  const currentSettings =
    activePlan && settings.plan !== activePlan
      ? await db.merchantSettings.update({
          where: { shop: session.shop },
          data: { plan: activePlan },
        })
      : settings;
  const analytics = await getProtectionAnalytics(session.shop);
  const planTier = await detectPlanTier(admin, session.shop);
  return { settings: currentSettings, analytics, hasActiveBilling, planTier };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const current = await db.merchantSettings.findUniqueOrThrow({
    where: { shop: session.shop },
  });

  const { hasActiveBilling, activePlan } = await getBillingState(billing);

  const protectionPayer = hasActiveBilling
    ? pickEnum(
        PROTECTION_PAYERS,
        formData.get("protectionPayer"),
        current.protectionPayer,
      )
    : current.protectionPayer;
  // Keep only recognised claim types, in canonical form, so an unknown/garbage
  // value can never reach the storefront claim form or downstream logic.
  const enabledClaimTypes = hasActiveBilling
    ? String(formData.get("enabledClaimTypes") ?? "")
        .split(",")
        .map((type) => type.trim())
        .filter((type) => CLAIM_ISSUE_TYPES.includes(type))
        .join(",")
    : current.enabledClaimTypes;
  // Re-serialize through the validating parser (and clamp to non-negative,
  // whole days) rather than persisting the raw client JSON.
  const claimWindows = hasActiveBilling
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
  const protectionFeeType = hasActiveBilling
    ? pickEnum(
        PROTECTION_FEE_TYPES,
        formData.get("protectionFeeType"),
        current.protectionFeeType,
      )
    : current.protectionFeeType;
  const protectionFlatFeeCents = hasActiveBilling
    ? Math.max(
        0,
        Math.round(Number(formData.get("protectionFlatFeeCents")) || 0),
      )
    : current.protectionFlatFeeCents;
  const protectionPercentBasisPoints = hasActiveBilling
    ? Math.min(
        10000,
        Math.max(
          0,
          Math.round(Number(formData.get("protectionPercentBasisPoints")) || 0),
        ),
      )
    : current.protectionPercentBasisPoints;
  const protectionMinFeeCents = hasActiveBilling
    ? Math.max(
        0,
        Math.round(Number(formData.get("protectionMinFeeCents")) || 0),
      )
    : current.protectionMinFeeCents;
  const protectionMaxFeeCents = hasActiveBilling
    ? Math.max(
        protectionMinFeeCents,
        Math.round(Number(formData.get("protectionMaxFeeCents")) || 0),
      )
    : current.protectionMaxFeeCents;
  const protectionEnabled = hasActiveBilling
    ? formData.get("protectionEnabled") === "true"
    : current.protectionEnabled;
  // `plan` decides whether the $0.60 per-order usage fee is waived, so it must
  // never come from client input. Derive it from the verified active
  // subscription — "unlimited" only when Shopify confirms an unlimited plan.
  const plan = activePlan === "unlimited" ? "unlimited" : "usage";

  if (
    formData.get("protectionEnabled") === "true" &&
    !current.protectionEnabled &&
    !hasActiveBilling
  ) {
    return {
      settings: current,
      error: "Approve a Kourify plan before enabling protection.",
    };
  }

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
      protectionEnabled,
      plan,
    },
  });

  try {
    const productSettings =
      protectionEnabled &&
      (!current.protectionEnabled ||
        current.protectionFlatFeeCents !== protectionFlatFeeCents ||
        !current.protectionVariantId)
        ? await syncProtectionProduct(
            session.shop,
            admin,
            protectionFlatFeeCents,
          )
        : settings;

    // Reconcile the Plus/dev percentage-fee Cart Transform. No-op on standard
    // plans or flat pricing; failures here must not break the settings save.
    try {
      const planTier = await detectPlanTier(admin, session.shop);
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

export default function Protection() {
  const { settings, analytics, hasActiveBilling, planTier } =
    useLoaderData<typeof loader>();
  // Percentage pricing at checkout runs via a Cart Transform price override,
  // which only takes effect on Shopify Plus. Warn whenever we positively know
  // the store isn't Plus (skip "unknown" to avoid a false alarm).
  const percentageUnsupported =
    planTier !== "plus" &&
    planTier !== "unknown" &&
    settings.protectionFeeType === "percentage";
  const settingsFetcher = useFetcher<{
    settings?: typeof settings;
    error?: string;
  }>();

  const startBilling = (plan: string) => {
    const url = new URL(window.location.href);
    url.pathname = "/app/billing";
    url.searchParams.set("plan", plan);
    window.location.assign(url.toString());
  };

  useFetcherToast(
    settingsFetcher,
    (data) => data.error ?? "Protection settings saved.",
  );

  const currentSettings = settingsFetcher.data?.settings ?? settings;
  const enabledTypes = new Set(
    (currentSettings.enabledClaimTypes ?? "").split(",").filter(Boolean),
  );
  const claimWindows = parseClaimWindows(currentSettings.claimWindows ?? "");
  const merchantPays = currentSettings.protectionPayer === "merchant";

  const saveSettings = (overrides: {
    protectionPayer?: string;
    enabledClaimTypes?: Set<string>;
    claimWindows?: ClaimWindows;
    protectionFeeType?: string;
    protectionFlatFeeCents?: number;
    protectionPercentBasisPoints?: number;
    protectionMinFeeCents?: number;
    protectionMaxFeeCents?: number;
    protectionEnabled?: boolean;
    plan?: string;
  }) => {
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
        protectionEnabled: String(
          overrides.protectionEnabled ?? currentSettings.protectionEnabled,
        ),
        plan: overrides.plan ?? currentSettings.plan,
      },
      { method: "POST" },
    );
  };

  const toggleClaimType = (value: string, checked: boolean) => {
    const next = new Set(enabledTypes);
    if (checked) {
      next.add(value);
    } else {
      next.delete(value);
    }
    saveSettings({ enabledClaimTypes: next });
  };

  const updateWindow = (
    type: string,
    field: "minDays" | "maxDays",
    value: number,
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
    saveSettings({ claimWindows: next });
  };

  return (
    <s-page>
      <PageHeader
        title="Protection settings"
        subtitle="Configure how the package protection widget behaves on your storefront."
        actions={
          <>
            <AppButton href="/app/claims" variant="secondary">
              View claims
            </AppButton>
            <AppButton href="/app" variant="secondary">
              Back
            </AppButton>
          </>
        }
      />

      {settingsFetcher.data?.error && (
        <s-banner tone="critical" heading="Protection could not be enabled">
          {settingsFetcher.data.error}
        </s-banner>
      )}

      <BillingStatusCard
        hasActiveBilling={hasActiveBilling}
        protectionEnabled={currentSettings.protectionEnabled}
        onChoosePlan={() => startBilling(currentSettings.plan)}
      />

      <Card heading="Enable protection">
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-text color="subdued">
            Offer customers protection against loss, damage, and theft at
            checkout.
          </s-text>
          <s-switch
            label="Enable protection at checkout"
            checked={currentSettings.protectionEnabled}
            disabled={settingsFetcher.state !== "idle" || !hasActiveBilling}
            onChange={(e) =>
              saveSettings({ protectionEnabled: e.currentTarget.checked })
            }
          />
        </s-stack>
      </Card>

      <Card heading="Plan">
        <s-choice-list
          label="Kourify billing plan"
          name="plan"
          values={[currentSettings.plan]}
          onChange={(e) => {
            const plan = e.currentTarget.values?.[0] ?? "usage";
            startBilling(plan);
          }}
        >
          <s-choice value="usage">
            $10/month + $0.60 per protected order
          </s-choice>
          <s-choice value="unlimited">
            $20/month · unlimited protected orders
          </s-choice>
        </s-choice-list>
      </Card>

      <Card heading="Protection performance">
        <div className="app-card-row">
          <StatTile
            icon="shield-check-mark"
            label="Protected orders"
            value={String(analytics.protectedOrders)}
          />
          <StatTile
            icon="chart-line"
            label="Selection rate"
            value={`${analytics.conversionRate.toFixed(1)}%`}
          />
          <StatTile
            icon="cash-dollar"
            label="Protection sales"
            value={`$${(analytics.protectionRevenueCents / 100).toFixed(2)}`}
          />
          <StatTile
            icon="receipt-dollar"
            label="Kourify usage fees"
            value={`$${(analytics.usageFeesCents / 100).toFixed(2)}`}
          />
        </div>
      </Card>

      <Card heading="Protection provider">
        <s-paragraph>
          The "Protect your order" widget is live on your product page and cart.
          It's an honest, self-funded guarantee right now — there's no real
          shipping-insurance underwriting behind it yet, so claims are reviewed
          manually rather than paid out automatically. Connect a real insurance
          partner (like EasyPost) before promising guaranteed payouts to
          customers.
        </s-paragraph>
      </Card>

      <Card heading="Who pays the protection fee" locked={!hasActiveBilling}>
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-text>
            Customer pays at checkout, or you cover it for every order at no
            extra charge to shoppers.
          </s-text>
          <div style={{ inlineSize: "200px", flex: "0 0 auto" }}>
            <s-select
              label="Who pays"
              labelAccessibilityVisibility="exclusive"
              disabled={!hasActiveBilling}
              value={currentSettings.protectionPayer}
              onChange={(e) =>
                saveSettings({ protectionPayer: e.currentTarget.value })
              }
            >
              <s-option value="customer">Customer pays</s-option>
              <s-option value="merchant">You pay (free to customer)</s-option>
            </s-select>
          </div>
        </s-stack>
      </Card>

      <Card heading="Pricing" locked={!hasActiveBilling}>
        <s-paragraph>
          How the protection fee is calculated. A flat fee is simplest; a
          percentage of order value scales fairly across cheap and expensive
          orders, with a floor and ceiling so it never charges a nonsense
          amount.
        </s-paragraph>
        {merchantPays && (
          <s-banner tone="info">
            You're covering the protection fee, so customers aren't charged and
            this pricing doesn't apply.
          </s-banner>
        )}
        {percentageUnsupported && !merchantPays && (
          <s-banner tone="warning">
            Percentage pricing only takes effect at checkout on Shopify Plus. On
            your current plan customers are charged the flat fee instead — switch
            to a flat fee so what they pay matches what's shown, or cover it
            yourself with merchant-pays.
          </s-banner>
        )}
        <s-stack direction="block" gap="base" paddingBlockStart="base">
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-text>Fee structure</s-text>
            <div style={{ inlineSize: "220px", flex: "0 0 auto" }}>
              <s-select
                label="Fee structure"
                labelAccessibilityVisibility="exclusive"
                disabled={!hasActiveBilling || merchantPays}
                value={currentSettings.protectionFeeType}
                onChange={(e) =>
                  saveSettings({ protectionFeeType: e.currentTarget.value })
                }
              >
                <s-option value="flat">Flat fee</s-option>
                <s-option value="percentage">Percentage of order</s-option>
              </s-select>
            </div>
          </s-stack>

          {currentSettings.protectionFeeType === "flat" ? (
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-text>Flat fee</s-text>
              <div style={{ inlineSize: "140px", flex: "0 0 auto" }}>
                <s-number-field
                  label="Flat fee"
                  labelAccessibilityVisibility="exclusive"
                  disabled={!hasActiveBilling || merchantPays}
                  prefix="$"
                  min={0}
                  step={0.01}
                  value={(currentSettings.protectionFlatFeeCents / 100).toFixed(
                    2,
                  )}
                  onChange={(e) =>
                    saveSettings({
                      protectionFlatFeeCents:
                        Math.round(Number(e.currentTarget.value) * 100) || 0,
                    })
                  }
                />
              </div>
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
                <div style={{ inlineSize: "140px", flex: "0 0 auto" }}>
                  <s-number-field
                    label="Percentage"
                    labelAccessibilityVisibility="exclusive"
                    disabled={!hasActiveBilling || merchantPays}
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
                          Math.round(Number(e.currentTarget.value) * 100) || 0,
                      })
                    }
                  />
                </div>
              </s-stack>
              <s-stack
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-text>Minimum fee</s-text>
                <div style={{ inlineSize: "140px", flex: "0 0 auto" }}>
                  <s-number-field
                    label="Minimum fee"
                    labelAccessibilityVisibility="exclusive"
                    disabled={!hasActiveBilling || merchantPays}
                    prefix="$"
                    min={0}
                    step={0.01}
                    value={(
                      currentSettings.protectionMinFeeCents / 100
                    ).toFixed(2)}
                    onChange={(e) =>
                      saveSettings({
                        protectionMinFeeCents:
                          Math.round(Number(e.currentTarget.value) * 100) || 0,
                      })
                    }
                  />
                </div>
              </s-stack>
              <s-stack
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-text>Maximum fee</s-text>
                <div style={{ inlineSize: "140px", flex: "0 0 auto" }}>
                  <s-number-field
                    label="Maximum fee"
                    labelAccessibilityVisibility="exclusive"
                    disabled={!hasActiveBilling || merchantPays}
                    prefix="$"
                    min={0}
                    step={0.01}
                    value={(
                      currentSettings.protectionMaxFeeCents / 100
                    ).toFixed(2)}
                    onChange={(e) =>
                      saveSettings({
                        protectionMaxFeeCents:
                          Math.round(Number(e.currentTarget.value) * 100) || 0,
                      })
                    }
                  />
                </div>
              </s-stack>
            </>
          )}
        </s-stack>
      </Card>

      <Card
        heading="Claim reasons customers can select"
        locked={!hasActiveBilling}
      >
        <s-paragraph>
          Choose which reasons show up in the "File a claim" form on your
          storefront.
        </s-paragraph>
        {enabledTypes.size === 0 && (
          <s-banner tone="warning">
            Nothing's checked, so the storefront will fall back to showing all
            six reasons until you enable at least one here.
          </s-banner>
        )}
        <s-stack direction="block" gap="small-200" paddingBlockStart="base">
          {ALL_ISSUE_TYPES.map((type) => (
            <s-checkbox
              key={type.value}
              label={type.label}
              checked={enabledTypes.has(type.value)}
              disabled={!hasActiveBilling}
              onChange={(e) =>
                toggleClaimType(type.value, e.currentTarget.checked ?? false)
              }
            />
          ))}
        </s-stack>
      </Card>

      <Card heading="Claim filing windows" locked={!hasActiveBilling}>
        <s-paragraph>
          How many days after an order ships a customer can file each type of
          claim. We check this against the order's real fulfillment date — a
          claim outside the window is rejected automatically.
        </s-paragraph>
        <s-stack direction="block" gap="base" paddingBlockStart="base">
          {ALL_ISSUE_TYPES.map((type) => {
            const w = claimWindows[type.value] ?? { minDays: 0, maxDays: 30 };
            return (
              <s-stack
                key={type.value}
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-text>{type.label}</s-text>
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <div style={{ inlineSize: "90px", flex: "0 0 auto" }}>
                    <s-number-field
                      label="Min days"
                      labelAccessibilityVisibility="exclusive"
                      min={0}
                      disabled={!hasActiveBilling}
                      value={String(w.minDays)}
                      onChange={(e) =>
                        updateWindow(
                          type.value,
                          "minDays",
                          Number(e.currentTarget.value) || 0,
                        )
                      }
                    />
                  </div>
                  <s-text color="subdued">to</s-text>
                  <div style={{ inlineSize: "90px", flex: "0 0 auto" }}>
                    <s-number-field
                      label="Max days"
                      labelAccessibilityVisibility="exclusive"
                      min={0}
                      disabled={!hasActiveBilling}
                      value={String(w.maxDays)}
                      onChange={(e) =>
                        updateWindow(
                          type.value,
                          "maxDays",
                          Number(e.currentTarget.value) || 0,
                        )
                      }
                    />
                  </div>
                  <s-text color="subdued">days</s-text>
                </s-stack>
              </s-stack>
            );
          })}
        </s-stack>
      </Card>
    </s-page>
  );
}
