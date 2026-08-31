import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
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
    create: { shop: session.shop },
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

  const settings = await db.merchantSettings.update({
    where: { shop: session.shop },
    data: { badgesEnabled, badgeStyle, showOnProduct, showOnCart },
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
            onChange={(e: any) => save({ badgesEnabled: e.target.checked })}
          />

          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text>Badge style</s-text>
            <div style={{ inlineSize: "160px", flex: "0 0 auto" }}>
              <s-select
                label="Badge style"
                labelAccessibilityVisibility="exclusive"
                value={current.badgeStyle}
                disabled={!current.badgesEnabled}
                onChange={(e: any) => save({ badgeStyle: e.target.value })}
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
            onChange={(e: any) => save({ showOnProduct: e.target.checked })}
          />
          <s-checkbox
            label="Show in cart"
            checked={current.showOnCart}
            disabled={!current.badgesEnabled}
            onChange={(e: any) => save({ showOnCart: e.target.checked })}
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
