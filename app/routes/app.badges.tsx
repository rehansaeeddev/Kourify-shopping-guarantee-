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
  const requestedBadgeStyle = String(formData.get("badgeStyle") ?? "classic");
  const badgeStyle = BADGE_STYLES.includes(
    requestedBadgeStyle as (typeof BADGE_STYLES)[number],
  )
    ? requestedBadgeStyle
    : "classic";
  const showOnProduct = formData.get("showOnProduct") === "true";
  const showOnCart = formData.get("showOnCart") === "true";
  // Language availability/fallback are managed on the Languages page, not here,
  // so this action deliberately leaves those fields untouched.

  const settings = await db.merchantSettings.update({
    where: { shop: session.shop },
    data: {
      badgesEnabled,
      badgeStyle,
      showOnProduct,
      showOnCart,
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

          <div className="app-badge-preview">
            <s-text color="subdued">Preview — what shoppers see</s-text>
            <div className="app-badge-preview__frame">
              <span className={`app-tb app-tb--${current.badgeStyle}`}>
                <svg
                  className="app-tb__icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M12 2 4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3Z"
                    fill="#065f46"
                  />
                  <path
                    d="M8.3 12.1l2.3 2.3 5-5"
                    stroke="#fff"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Guaranteed Safe Checkout</span>
              </span>
            </div>
          </div>

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
