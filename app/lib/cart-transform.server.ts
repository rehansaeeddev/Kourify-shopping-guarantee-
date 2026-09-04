import db from "../db.server";
import { supportsCartTransform, type PlanTier } from "./plan-tier.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/** Must match the extension handle in extensions/kourify-dynamic-fee/shopify.extension.toml. */
const FUNCTION_HANDLE = "kourify-dynamic-fee";
const FEE_NAMESPACE = "$app:kourify";
const FEE_KEY = "fee_config";

type FeeSettings = {
  shop: string;
  protectionEnabled: boolean;
  protectionFeeType: string;
  protectionPercentBasisPoints: number;
  protectionMinFeeCents: number;
  protectionMaxFeeCents: number;
  protectionVariantId: string | null;
  cartTransformId: string | null;
};

function feeConfigJson(settings: FeeSettings): string {
  return JSON.stringify({
    percentBasisPoints: settings.protectionPercentBasisPoints,
    minCents: settings.protectionMinFeeCents,
    maxCents: settings.protectionMaxFeeCents,
    variantId: settings.protectionVariantId,
  });
}

async function createCartTransform(
  admin: AdminGraphqlClient,
  configJson: string,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
      mutation ActivateDynamicFee($metafields: [MetafieldInput!]) {
        cartTransformCreate(
          functionHandle: "${FUNCTION_HANDLE}"
          blockOnFailure: false
          metafields: $metafields
        ) {
          cartTransform { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            namespace: FEE_NAMESPACE,
            key: FEE_KEY,
            type: "json",
            value: configJson,
          },
        ],
      },
    },
  );
  const json = await response.json();
  const result = json?.data?.cartTransformCreate;
  if (result?.userErrors?.length) {
    console.error("[cart-transform] create userErrors", result.userErrors);
    return null;
  }
  return result?.cartTransform?.id ?? null;
}

async function setFeeConfig(
  admin: AdminGraphqlClient,
  ownerId: string,
  configJson: string,
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
      mutation SetFeeConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: FEE_NAMESPACE,
            key: FEE_KEY,
            type: "json",
            value: configJson,
          },
        ],
      },
    },
  );
  const json = await response.json();
  const errors = json?.data?.metafieldsSet?.userErrors;
  if (errors?.length) console.error("[cart-transform] setFeeConfig", errors);
}

async function deleteCartTransform(
  admin: AdminGraphqlClient,
  id: string,
): Promise<void> {
  const response = await admin.graphql(
    `#graphql
      mutation DeleteDynamicFee($id: ID!) {
        cartTransformDelete(id: $id) {
          deletedId
          userErrors { field message }
        }
      }`,
    { variables: { id } },
  );
  const json = await response.json();
  const errors = json?.data?.cartTransformDelete?.userErrors;
  if (errors?.length) console.error("[cart-transform] delete", errors);
}

/**
 * Reconciles the percentage-fee Cart Transform with the merchant's settings.
 * Only Plus/dev stores using percentage pricing with a configured variant get
 * the function; anything else falls back to the flat variant and any previously
 * created cart transform is removed. Safe to call on every settings save.
 */
export async function syncDynamicFee(
  admin: AdminGraphqlClient,
  settings: FeeSettings,
  planTier: PlanTier,
): Promise<void> {
  const shouldRun =
    supportsCartTransform(planTier) &&
    settings.protectionEnabled &&
    settings.protectionFeeType === "percentage" &&
    Boolean(settings.protectionVariantId);

  if (!shouldRun) {
    if (settings.cartTransformId) {
      await deleteCartTransform(admin, settings.cartTransformId);
      await db.merchantSettings
        .update({
          where: { shop: settings.shop },
          data: { cartTransformId: null },
        })
        .catch(() => null);
    }
    return;
  }

  const configJson = feeConfigJson(settings);

  if (settings.cartTransformId) {
    // Already active — just refresh the config metafield.
    await setFeeConfig(admin, settings.cartTransformId, configJson);
    return;
  }

  const id = await createCartTransform(admin, configJson);
  if (id) {
    await db.merchantSettings
      .update({
        where: { shop: settings.shop },
        data: { cartTransformId: id },
      })
      .catch(() => null);
  }
}
