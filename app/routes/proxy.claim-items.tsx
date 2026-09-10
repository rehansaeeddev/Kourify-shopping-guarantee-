import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { findOrderByNumberWithCache } from "../lib/order-sync.server";
import { isRateLimited, clientIpFromRequest } from "../lib/rate-limit.server";
import { authenticate } from "../shopify.server";

/**
 * Resolves the protected, still-claimable items on an order so the storefront
 * claim form can present a real item picker instead of asking the shopper to
 * describe what went wrong in prose.
 *
 * Deliberately mirrors the identity checks in `proxy.claim.tsx` — order must
 * resolve, order must carry an email, and the caller's email must match it —
 * so this endpoint can't be used to enumerate order contents. It never reveals
 * whether an order exists to a caller with the wrong email.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const ip = clientIpFromRequest(request);
  const shopParam = new URL(request.url).searchParams.get("shop") ?? "unknown";
  if (
    await isRateLimited(`claim-items:${shopParam}:${ip}`, 20, 10 * 60 * 1000)
  ) {
    return Response.json(
      { error: "Too many lookups. Please try again shortly." },
      { status: 429 },
    );
  }

  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return Response.json({ error: "Unknown shop" }, { status: 400 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { orderNumber, email } = body as Record<string, unknown>;
  if (
    typeof orderNumber !== "string" ||
    !orderNumber.trim() ||
    orderNumber.trim().length > 100 ||
    typeof email !== "string" ||
    !email.trim() ||
    email.trim().length > 254
  ) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // One generic message for every identity failure — knowing whether the order
  // number or the email was wrong would let a caller probe for valid orders.
  const identityFailure = Response.json(
    {
      error:
        "We couldn't match that order number and email. Please check your order confirmation.",
    },
    { status: 400 },
  );

  const order = await findOrderByNumberWithCache(
    admin,
    session.shop,
    orderNumber,
  );
  if (!order) return identityFailure;

  const orderEmail = order.email?.trim().toLowerCase() ?? "";
  if (!orderEmail || orderEmail !== normalizedEmail) return identityFailure;

  const protectedOrder = await db.protectedOrder.findUnique({
    where: {
      shop_shopifyOrderId: { shop: session.shop, shopifyOrderId: order.id },
    },
    include: { items: true },
  });

  if (!protectedOrder) {
    return Response.json(
      {
        protected: false,
        error:
          "This order doesn't include Kourify protection, so a claim can't be filed against it.",
      },
      { status: 200 },
    );
  }
  if (protectedOrder.revokedAt) {
    return Response.json(
      {
        protected: false,
        error:
          "Protection on this order is no longer active, so a new claim can't be filed.",
      },
      { status: 200 },
    );
  }

  // Quantity already spoken for by open or approved claims. Denied claims
  // release their units back, matching assessEligibleLoss().
  const priorClaims = await db.protectionClaim.findMany({
    where: {
      shop: session.shop,
      protectedOrderId: protectedOrder.id,
      status: { in: ["submitted", "reviewing", "resolved"] },
    },
    select: { protectedItemId: true, claimedQuantity: true, status: true },
  });
  const claimedByItem = new Map<string, number>();
  const itemsWithOpenClaim = new Set<string>();
  for (const claim of priorClaims) {
    if (!claim.protectedItemId) continue;
    claimedByItem.set(
      claim.protectedItemId,
      (claimedByItem.get(claim.protectedItemId) ?? 0) +
        (claim.claimedQuantity ?? 0),
    );
    if (claim.status === "submitted" || claim.status === "reviewing") {
      itemsWithOpenClaim.add(claim.protectedItemId);
    }
  }

  // Hide items that already have an open claim — assessEligibleLoss rejects
  // them anyway, so offering them would only produce an error on submit.
  const items = protectedOrder.items
    .filter((item) => item.eligible && !itemsWithOpenClaim.has(item.id))
    .map((item) => ({
      id: item.id,
      title: item.title,
      sku: item.sku,
      unitPriceCents: item.unitPriceCents,
      orderedQuantity: item.quantity,
      remainingQuantity: Math.max(
        0,
        item.quantity - (claimedByItem.get(item.id) ?? 0),
      ),
    }))
    .filter((item) => item.remainingQuantity > 0);

  const ineligibleCount = protectedOrder.items.filter(
    (item) => !item.eligible,
  ).length;

  return Response.json({
    protected: true,
    currency: protectedOrder.currency,
    items,
    ineligibleCount,
  });
};
