import { createHash } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

type LiquidRenderer = (
  body: string,
  options?: { layout?: boolean },
) => Response;

function offerFailure(
  liquid: LiquidRenderer,
  detail: Record<string, unknown>,
): Response {
  console.error("[proxy.offer] failed", JSON.stringify(detail));
  const body =
    process.env.NODE_ENV !== "production"
      ? `<p>Could not add protection — dev detail below.</p><pre style="white-space:pre-wrap;text-align:left;font-size:12px;background:#f6f6f6;padding:12px;border-radius:8px;overflow:auto">${escapeHtml(
          JSON.stringify(detail, null, 2),
        )}</pre>`
      : "<p>We couldn't add protection to your order right now. Please try again later.</p>";
  return liquid(body, { layout: false });
}

async function getOffer(shop: string, token: string) {
  if (!token || token.length > 100) return null;
  return db.protectionOffer.findFirst({
    where: { shop, tokenHash: tokenHash(token) },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid, session } = await authenticate.public.appProxy(request);
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const offer = session ? await getOffer(session.shop, token) : null;
  const active =
    offer &&
    offer.expiresAt > new Date() &&
    ["offer_sent", "awaiting_payment"].includes(offer.status);
  const price = offer
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: offer.currency,
      }).format(offer.protectionPriceCents / 100)
    : "";

  const content = !offer
    ? "This protection offer is invalid."
    : offer.status === "payment_confirmed"
      ? `Payment confirmed. ${escapeHtml(offer.originalOrderName)} is now protected.`
      : !active
        ? "This protection offer has expired. Your order will continue normally."
        : `Add optional Kourify Shopping Guarantee to ${escapeHtml(offer.originalOrderName)} for ${escapeHtml(price)}. Protection begins only after Shopify confirms payment.`;
  const button = active
    ? `<form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Accept and continue to secure payment</button></form>`
    : "";
  return liquid(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Protection offer · Kourify</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f8f7;color:#102a2a;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(100%,560px);padding:40px;border:1px solid #dce9e6;border-radius:24px;background:#fff;box-shadow:0 24px 70px rgba(24,73,67,.14)}h1{margin:0 0 16px;font-size:32px}p{color:#647473;line-height:1.65}button{width:100%;margin-top:20px;padding:14px 18px;border:0;border-radius:12px;background:#087466;color:#fff;font:inherit;font-weight:800;cursor:pointer}.note{font-size:12px}</style></head><body><main class="card"><p>Kourify Shopping Guarantee</p><h1>Optional order protection</h1><p>${content}</p>${button}<p class="note">Protection is optional. Declining it will not delay fulfillment of your original order.</p></main></body></html>`,
    { layout: false },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { liquid, session, admin } =
    await authenticate.public.appProxy(request);
  try {
  const formData = await request.formData();
  const token = String(formData.get("token") ?? "");
  const offer = session ? await getOffer(session.shop, token) : null;
  if (
    !offer ||
    offer.expiresAt <= new Date() ||
    offer.status !== "offer_sent" ||
    !admin
  ) {
    return liquid("<p>This offer is no longer available.</p>", {
      layout: false,
    });
  }

  const beginResponse = await admin.graphql(
    `#graphql
      mutation kourifyOfferBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`,
    { variables: { id: offer.originalOrderId } },
  );
  const beginJson = await beginResponse.json();
  const calculatedOrderId = beginJson.data?.orderEditBegin?.calculatedOrder?.id;
  if (!calculatedOrderId) {
    return offerFailure(liquid, {
      step: "orderEditBegin",
      orderId: offer.originalOrderId,
      errors: (beginJson as { errors?: unknown }).errors,
      userErrors: beginJson.data?.orderEditBegin?.userErrors,
    });
  }

  const addResponse = await admin.graphql(
    `#graphql
      mutation kourifyOfferAdd($id: ID!, $price: MoneyInput!) {
        orderEditAddCustomItem(
          id: $id,
          title: "Kourify Order Protection",
          price: $price,
          quantity: 1,
          requiresShipping: false,
          taxable: false
        ) {
          calculatedLineItem { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        id: calculatedOrderId,
        price: {
          amount: (offer.protectionPriceCents / 100).toFixed(2),
          currencyCode: offer.currency,
        },
      },
    },
  );
  const addJson = await addResponse.json();
  if (!addJson.data?.orderEditAddCustomItem?.calculatedLineItem?.id) {
    return offerFailure(liquid, {
      step: "orderEditAddCustomItem",
      calculatedOrderId,
      errors: (addJson as { errors?: unknown }).errors,
      userErrors: addJson.data?.orderEditAddCustomItem?.userErrors,
    });
  }

  const commitResponse = await admin.graphql(
    `#graphql
      mutation kourifyOfferCommit($id: ID!) {
        orderEditCommit(
          id: $id,
          notifyCustomer: true,
          staffNote: "Customer accepted optional Kourify protection; awaiting payment."
        ) {
          order { id }
          userErrors { field message }
        }
      }`,
    { variables: { id: calculatedOrderId } },
  );
  const commitJson = await commitResponse.json();
  if (!commitJson.data?.orderEditCommit?.order?.id) {
    return offerFailure(liquid, {
      step: "orderEditCommit",
      calculatedOrderId,
      errors: (commitJson as { errors?: unknown }).errors,
      userErrors: commitJson.data?.orderEditCommit?.userErrors,
    });
  }

  await db.protectionOffer.update({
    where: { id: offer.id },
    data: { status: "awaiting_payment" },
  });
  return liquid(
    "<p>Protection was added to your order. Shopify has sent payment instructions. Your order becomes protected only after payment succeeds.</p>",
    { layout: false },
  );
  } catch (error) {
    return offerFailure(liquid, {
      step: "exception",
      message: error instanceof Error ? error.message : String(error),
      stack:
        process.env.NODE_ENV !== "production" && error instanceof Error
          ? error.stack
          : undefined,
    });
  }
};
