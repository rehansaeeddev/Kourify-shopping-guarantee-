import fs from "node:fs";
import path from "node:path";
import db from "../db.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const LOGO_ASSET_PATH = path.join(process.cwd(), "public", "kourify-logo.png");

async function graphqlData(
  admin: AdminGraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await admin.graphql(query, { variables });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((e: { message: string }) => e.message).join(", "));
  return body.data;
}

// Checkout/cart only show a product's real Shopify catalog image, which
// productCreate leaves empty — this backfills it once via a staged upload,
// for both newly-created products and pre-existing ones missing an image.
async function ensureProtectionProductImage(admin: AdminGraphqlClient, productId: string) {
  const existing = await graphqlData(
    admin,
    `#graphql
      query KourifyProtectionProductMedia($id: ID!) {
        product(id: $id) { media(first: 1) { nodes { id } } }
      }`,
    { id: productId },
  );
  if (existing.product?.media?.nodes?.length) return;

  const fileBuffer = fs.readFileSync(LOGO_ASSET_PATH);

  const staged = await graphqlData(
    admin,
    `#graphql
      mutation KourifyStagedUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }`,
    {
      input: [
        {
          resource: "IMAGE",
          filename: "kourify-logo.png",
          mimeType: "image/png",
          httpMethod: "POST",
          fileSize: String(fileBuffer.byteLength),
        },
      ],
    },
  );
  const stagedErrors = staged.stagedUploadsCreate.userErrors;
  if (stagedErrors.length) throw new Error(stagedErrors.map((e: { message: string }) => e.message).join(", "));
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("Failed to create staged upload for the protection product image.");

  const form = new FormData();
  for (const { name, value } of target.parameters as { name: string; value: string }[]) {
    form.append(name, value);
  }
  form.append("file", new Blob([fileBuffer], { type: "image/png" }), "kourify-logo.png");

  const uploadResponse = await fetch(target.url, { method: "POST", body: form });
  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload the protection product image (status ${uploadResponse.status}).`);
  }

  const created = await graphqlData(
    admin,
    `#graphql
      mutation KourifyCreateProtectionMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { id }
          mediaUserErrors { field message }
        }
      }`,
    {
      productId,
      media: [{ originalSource: target.resourceUrl, mediaContentType: "IMAGE" }],
    },
  );
  const mediaErrors = created.productCreateMedia.mediaUserErrors;
  if (mediaErrors.length) throw new Error(mediaErrors.map((e: { message: string }) => e.message).join(", "));
}

export async function syncProtectionProduct(
  shop: string,
  admin: AdminGraphqlClient,
  priceCents: number,
) {
  let settings = await db.merchantSettings.findUniqueOrThrow({ where: { shop } });
  let productId = settings.protectionProductId;
  let variantId = settings.protectionVariantId;

  if (!productId || !variantId) {
    const existing = await graphqlData(
      admin,
      `#graphql
        query KourifyProtectionProduct {
          products(first: 1, query: "handle:kourify-order-protection") {
            nodes { id variants(first: 1) { nodes { id } } }
          }
        }`,
    );
    productId = existing.products.nodes[0]?.id ?? null;
    variantId = existing.products.nodes[0]?.variants.nodes[0]?.id ?? null;
  }

  if (!productId || !variantId) {
    const created = await graphqlData(
      admin,
      `#graphql
        mutation KourifyCreateProtectionProduct($input: ProductCreateInput!) {
          productCreate(product: $input) {
            product { id variants(first: 1) { nodes { id } } }
            userErrors { field message }
          }
        }`,
      {
        input: {
          title: "Kourify Order Protection",
          handle: "kourify-order-protection",
          descriptionHtml: "Coverage against package loss, damage, and theft.",
          productType: "Order protection",
          vendor: "Kourify",
          status: "ACTIVE",
          tags: ["kourify-protection"],
        },
      },
    );
    const errors = created.productCreate.userErrors;
    if (errors.length) throw new Error(errors.map((e: { message: string }) => e.message).join(", "));
    productId = created.productCreate.product.id;
    variantId = created.productCreate.product.variants.nodes[0].id;
  }

  const updated = await graphqlData(
    admin,
    `#graphql
      mutation KourifyPriceProtectionVariant(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }`,
    { productId, variants: [{ id: variantId, price: (priceCents / 100).toFixed(2) }] },
  );
  const updateErrors = updated.productVariantsBulkUpdate.userErrors;
  if (updateErrors.length) throw new Error(updateErrors.map((e: { message: string }) => e.message).join(", "));

  try {
    await ensureProtectionProductImage(admin, productId!);
  } catch (error) {
    // Cosmetic only (checkout/cart falls back to a placeholder icon) —
    // don't fail protection setup over it.
    console.error("[protection-product] failed to set product image", error);
  }

  // Make the component available to every publication attached to the shop.
  const publications = await graphqlData(
    admin,
    `#graphql
      query KourifyPublications { publications(first: 20) { nodes { id } } }`,
  );
  if (publications.publications.nodes.length) {
    const published = await graphqlData(
      admin,
      `#graphql
        mutation KourifyPublishProtection($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) { userErrors { field message } }
        }`,
      {
        id: productId,
        input: publications.publications.nodes.map(({ id }: { id: string }) => ({ publicationId: id })),
      },
    );
    const publishErrors = published.publishablePublish.userErrors;
    if (publishErrors.length) throw new Error(publishErrors.map((e: { message: string }) => e.message).join(", "));
  }

  settings = await db.merchantSettings.update({
    where: { shop },
    data: { protectionProductId: productId, protectionVariantId: variantId },
  });
  return settings;
}
