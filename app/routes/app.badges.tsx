import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { DEFAULT_CLAIM_WINDOWS } from "../lib/claim-window";
import { PageHeader } from "../components/PageHeader";
import { Card } from "../components/Card";
import { AppButton } from "../components/AppButton";
import { useFetcherToast } from "../hooks/useFetcherToast";

const BADGE_STYLES = ["classic", "minimal", "bold"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const settings = await db.merchantSettings.upsert({
    where: { shop: session.shop },
    update: {},
    create: {
      shop: session.shop,
      claimWindows: JSON.stringify(DEFAULT_CLAIM_WINDOWS),
    },
  });

  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const badgesEnabled = formData.get("badgesEnabled") === "true";
  const badgeStyle = String(formData.get("badgeStyle") ?? "classic");
  const showOnProduct = formData.get("showOnProduct") === "true";
  const showOnCart = formData.get("showOnCart") === "true";
  const storefrontFallbackLanguage =
    formData.get("storefrontFallbackLanguage") === "fr" ? "fr" : "en";
  const storefrontLanguages = ["en", "fr"]
    .filter((language) => formData.get(`language_${language}`) === "true")
    .join(",");

  const settings = await db.merchantSettings.update({
    where: { shop: session.shop },
    data: {
      badgesEnabled,
      badgeStyle,
      showOnProduct,
      showOnCart,
      storefrontFallbackLanguage,
      storefrontLanguages: storefrontLanguages || storefrontFallbackLanguage,
    },
  });

  return { settings };
};

export default function Badges() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isSaving = fetcher.state !== "idle";
  const current = fetcher.data?.settings ?? settings;

  useFetcherToast(fetcher, () => "Badge settings saved.");

  const save = (overrides: Partial<typeof current> = {}) => {
    const next = { ...current, ...overrides };
    fetcher.submit(
      {
        badgesEnabled: String(next.badgesEnabled),
        badgeStyle: next.badgeStyle,
        showOnProduct: String(next.showOnProduct),
        showOnCart: String(next.showOnCart),
        storefrontFallbackLanguage: next.storefrontFallbackLanguage,
        language_en: String(next.storefrontLanguages.split(",").includes("en")),
        language_fr: String(next.storefrontLanguages.split(",").includes("fr")),
      },
      { method: "POST" },
    );
  };

  return (
    <s-page>
      <PageHeader
        title="Trust badges"
        subtitle="Show a trust badge on your storefront to reassure shoppers before they check out."
        actions={
          <AppButton href="/app" variant="secondary">
            Back
          </AppButton>
        }
      />

      <Card heading="Safe Shopping Trustmarks">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Show trust badge on storefront"
            checked={current.badgesEnabled}
            onChange={(e) => save({ badgesEnabled: e.currentTarget.checked })}
          />

          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-text>Badge style</s-text>
            <div style={{ inlineSize: "160px", flex: "0 0 auto" }}>
              <s-select
                label="Badge style"
                labelAccessibilityVisibility="exclusive"
                value={current.badgeStyle}
                disabled={!current.badgesEnabled}
                onChange={(e) => save({ badgeStyle: e.currentTarget.value })}
              >
                {BADGE_STYLES.map((style) => (
                  <s-option key={style} value={style}>
                    {style.charAt(0).toUpperCase() + style.slice(1)}
                  </s-option>
                ))}
              </s-select>
            </div>
          </s-stack>

          <s-checkbox
            label="Show on product pages"
            checked={current.showOnProduct}
            disabled={!current.badgesEnabled}
            onChange={(e) => save({ showOnProduct: e.currentTarget.checked })}
          />
          <s-checkbox
            label="Show in cart"
            checked={current.showOnCart}
            disabled={!current.badgesEnabled}
            onChange={(e) => save({ showOnCart: e.currentTarget.checked })}
          />
        </s-stack>

        {isSaving && <s-paragraph>Saving…</s-paragraph>}
      </Card>

      <Card heading="Storefront languages">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            The protection widget and claim form follow the customer&apos;s
            active Shopify language. Choose which translations are available and
            the fallback used when a translation is unavailable.
          </s-paragraph>
          <s-checkbox
            label="English"
            checked={current.storefrontLanguages.split(",").includes("en")}
            onChange={(event) => {
              const languages = new Set(
                current.storefrontLanguages.split(",").filter(Boolean),
              );
              event.currentTarget.checked
                ? languages.add("en")
                : languages.delete("en");
              save({ storefrontLanguages: [...languages].join(",") });
            }}
          />
          <s-checkbox
            label="French"
            checked={current.storefrontLanguages.split(",").includes("fr")}
            onChange={(event) => {
              const languages = new Set(
                current.storefrontLanguages.split(",").filter(Boolean),
              );
              event.currentTarget.checked
                ? languages.add("fr")
                : languages.delete("fr");
              save({ storefrontLanguages: [...languages].join(",") });
            }}
          />
          <s-select
            label="Fallback language"
            value={current.storefrontFallbackLanguage}
            onChange={(event) =>
              save({
                storefrontFallbackLanguage: event.currentTarget.value ?? "en",
              })
            }
          >
            <s-option value="en">English</s-option>
            <s-option value="fr">French</s-option>
          </s-select>
        </s-stack>
      </Card>

      <s-section slot="aside" heading="Add the badge to your theme">
        <s-paragraph>
          After saving, open the theme editor and add the{" "}
          <s-text type="strong">Kourify Trust Badge</s-text> block to your
          product and cart templates. It reads these settings automatically.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
