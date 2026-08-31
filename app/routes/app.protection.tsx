import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PageHeader } from "../components/PageHeader";
import { Card } from "../components/Card";
import { AppButton } from "../components/AppButton";
import { useFetcherToast } from "../hooks/useFetcherToast";
import { ALL_ISSUE_TYPES } from "../lib/claim-issue-type";
import { parseClaimWindows, type ClaimWindows } from "../lib/claim-window";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const settings = await db.merchantSettings.upsert({
    where: { shop: session.shop },
    update: {},
    create: { shop: session.shop },
  });

  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const protectionPayer = String(formData.get("protectionPayer") ?? "customer");
  const enabledClaimTypes = String(formData.get("enabledClaimTypes") ?? "");
  const claimWindows = String(formData.get("claimWindows") ?? "");
  const protectionFeeType = String(formData.get("protectionFeeType") ?? "flat");
  const protectionFlatFeeCents = Math.max(
    0,
    Math.round(Number(formData.get("protectionFlatFeeCents")) || 0),
  );
  const protectionPercentBasisPoints = Math.min(
    10000,
    Math.max(0, Math.round(Number(formData.get("protectionPercentBasisPoints")) || 0)),
  );
  const protectionMinFeeCents = Math.max(
    0,
    Math.round(Number(formData.get("protectionMinFeeCents")) || 0),
  );
  const protectionMaxFeeCentsRaw = Math.round(Number(formData.get("protectionMaxFeeCents")) || 0);
  const protectionMaxFeeCents = Math.max(protectionMinFeeCents, protectionMaxFeeCentsRaw);

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
    },
  });

  return { settings };
};

export default function Protection() {
  const { settings } = useLoaderData<typeof loader>();
  const settingsFetcher = useFetcher<{ settings?: typeof settings }>();

  useFetcherToast(settingsFetcher, () => "Protection settings saved.");

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
  }) => {
    const nextPayer = overrides.protectionPayer ?? currentSettings.protectionPayer;
    const nextTypes = overrides.enabledClaimTypes ?? enabledTypes;
    const nextWindows = overrides.claimWindows ?? claimWindows;
    settingsFetcher.submit(
      {
        protectionPayer: nextPayer,
        enabledClaimTypes: Array.from(nextTypes).join(","),
        claimWindows: JSON.stringify(nextWindows),
        protectionFeeType: overrides.protectionFeeType ?? currentSettings.protectionFeeType,
        protectionFlatFeeCents: String(
          overrides.protectionFlatFeeCents ?? currentSettings.protectionFlatFeeCents,
        ),
        protectionPercentBasisPoints: String(
          overrides.protectionPercentBasisPoints ?? currentSettings.protectionPercentBasisPoints,
        ),
        protectionMinFeeCents: String(
          overrides.protectionMinFeeCents ?? currentSettings.protectionMinFeeCents,
        ),
        protectionMaxFeeCents: String(
          overrides.protectionMaxFeeCents ?? currentSettings.protectionMaxFeeCents,
        ),
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

  const updateWindow = (type: string, field: "minDays" | "maxDays", value: number) => {
    const next: ClaimWindows = {
      ...claimWindows,
      [type]: {
        minDays: field === "minDays" ? value : (claimWindows[type]?.minDays ?? 0),
        maxDays: field === "maxDays" ? value : (claimWindows[type]?.maxDays ?? 30),
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

      <s-banner tone="info">
        The "Protect your order" widget is live on your product page and
        cart. It's an honest, self-funded guarantee right now — there's no
        real shipping-insurance underwriting behind it yet, so claims are
        reviewed manually rather than paid out automatically. Connect a real
        insurance partner (like EasyPost) before promising guaranteed
        payouts to customers.
      </s-banner>

      <Card heading="Who pays the protection fee">
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-text>
            Customer pays at checkout, or you cover it for every order at no
            extra charge to shoppers.
          </s-text>
          <div style={{ inlineSize: "200px", flex: "0 0 auto" }}>
            <s-select
              label="Who pays"
              labelAccessibilityVisibility="exclusive"
              value={currentSettings.protectionPayer}
              onChange={(e: any) => saveSettings({ protectionPayer: e.target.value })}
            >
              <s-option value="customer">Customer pays</s-option>
              <s-option value="merchant">You pay (free to customer)</s-option>
            </s-select>
          </div>
        </s-stack>
      </Card>

      <Card heading="Pricing">
        <s-paragraph>
          How the protection fee is calculated. A flat fee is simplest; a
          percentage of order value scales fairly across cheap and
          expensive orders, with a floor and ceiling so it never charges a
          nonsense amount.
        </s-paragraph>
        {merchantPays && (
          <s-banner tone="info">
            You're covering the protection fee, so customers aren't charged
            and this pricing doesn't apply.
          </s-banner>
        )}
        <s-stack direction="block" gap="base" paddingBlockStart="base">
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text>Fee structure</s-text>
            <div style={{ inlineSize: "220px", flex: "0 0 auto" }}>
              <s-select
                label="Fee structure"
                labelAccessibilityVisibility="exclusive"
                disabled={merchantPays}
                value={currentSettings.protectionFeeType}
                onChange={(e: any) => saveSettings({ protectionFeeType: e.target.value })}
              >
                <s-option value="flat">Flat fee</s-option>
                <s-option value="percentage">Percentage of order</s-option>
              </s-select>
            </div>
          </s-stack>

          {currentSettings.protectionFeeType === "flat" ? (
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-text>Flat fee</s-text>
              <div style={{ inlineSize: "140px", flex: "0 0 auto" }}>
                <s-number-field
                  label="Flat fee"
                  labelAccessibilityVisibility="exclusive"
                  disabled={merchantPays}
                  prefix="$"
                  min={0}
                  step={0.01}
                  value={(currentSettings.protectionFlatFeeCents / 100).toFixed(2)}
                  onChange={(e: any) =>
                    saveSettings({
                      protectionFlatFeeCents: Math.round(Number(e.target.value) * 100) || 0,
                    })
                  }
                />
              </div>
            </s-stack>
          ) : (
            <>
              <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                <s-text>Percentage of order value</s-text>
                <div style={{ inlineSize: "140px", flex: "0 0 auto" }}>
                  <s-number-field
                    label="Percentage"
                    labelAccessibilityVisibility="exclusive"
                    disabled={merchantPays}
                    suffix="%"
                    min={0}
                    max={100}
                    step={0.1}
                    value={(currentSettings.protectionPercentBasisPoints / 100).toFixed(1)}
                    onChange={(e: any) =>
                      saveSettings({
                        protectionPercentBasisPoints:
                          Math.round(Number(e.target.value) * 100) || 0,
                      })
                    }
                  />
                </div>
              </s-stack>
              <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                <s-text>Minimum fee</s-text>
                <div style={{ inlineSize: "140px", flex: "0 0 auto" }}>
                  <s-number-field
                    label="Minimum fee"
                    labelAccessibilityVisibility="exclusive"
                    disabled={merchantPays}
                    prefix="$"
                    min={0}
                    step={0.01}
                    value={(currentSettings.protectionMinFeeCents / 100).toFixed(2)}
                    onChange={(e: any) =>
                      saveSettings({
                        protectionMinFeeCents: Math.round(Number(e.target.value) * 100) || 0,
                      })
                    }
                  />
                </div>
              </s-stack>
              <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                <s-text>Maximum fee</s-text>
                <div style={{ inlineSize: "140px", flex: "0 0 auto" }}>
                  <s-number-field
                    label="Maximum fee"
                    labelAccessibilityVisibility="exclusive"
                    disabled={merchantPays}
                    prefix="$"
                    min={0}
                    step={0.01}
                    value={(currentSettings.protectionMaxFeeCents / 100).toFixed(2)}
                    onChange={(e: any) =>
                      saveSettings({
                        protectionMaxFeeCents: Math.round(Number(e.target.value) * 100) || 0,
                      })
                    }
                  />
                </div>
              </s-stack>
            </>
          )}
        </s-stack>
      </Card>

      <Card heading="Claim reasons customers can select">
        <s-paragraph>
          Choose which reasons show up in the "File a claim" form on your
          storefront.
        </s-paragraph>
        {enabledTypes.size === 0 && (
          <s-banner tone="warning">
            Nothing's checked, so the storefront will fall back to showing
            all six reasons until you enable at least one here.
          </s-banner>
        )}
        <s-stack direction="block" gap="small-200" paddingBlockStart="base">
          {ALL_ISSUE_TYPES.map((type) => (
            <s-checkbox
              key={type.value}
              label={type.label}
              checked={enabledTypes.has(type.value)}
              onChange={(e: any) => toggleClaimType(type.value, e.target.checked)}
            />
          ))}
        </s-stack>
      </Card>

      <Card heading="Claim filing windows">
        <s-paragraph>
          How many days after an order ships a customer can file each type
          of claim. We check this against the order's real fulfillment date
          — a claim outside the window is rejected automatically.
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
                      value={String(w.minDays)}
                      onChange={(e: any) =>
                        updateWindow(type.value, "minDays", Number(e.target.value) || 0)
                      }
                    />
                  </div>
                  <s-text color="subdued">to</s-text>
                  <div style={{ inlineSize: "90px", flex: "0 0 auto" }}>
                    <s-number-field
                      label="Max days"
                      labelAccessibilityVisibility="exclusive"
                      min={0}
                      value={String(w.maxDays)}
                      onChange={(e: any) =>
                        updateWindow(type.value, "maxDays", Number(e.target.value) || 0)
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
