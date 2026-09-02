import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { findOrderRiskLevel } from "../lib/order-lookup.server";
import { findOrderByNumberWithCache } from "../lib/order-sync.server";
import { parseClaimWindows, EVIDENCE_REQUIRED_TYPES } from "../lib/claim-window";
import { uploadEvidenceImage } from "../lib/upload-evidence.server";
import { isRateLimited, clientIpFromRequest } from "../lib/rate-limit.server";
import { notifyClaimSubmitted } from "../lib/notify.server";

const MAX_BODY_BYTES = 8 * 1024 * 1024; // ~8MB, enough headroom for a 5MB image base64-encoded
const MAX_EVIDENCE_BASE64_CHARS = 7 * 1024 * 1024; // ~5MB raw image, base64-encoded (~1.33x inflation)

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "That request is too large." }, { status: 413 });
  }

  const ip = clientIpFromRequest(request);
  if (isRateLimited(`claim:${ip}`, 5, 10 * 60 * 1000)) {
    return Response.json(
      { error: "Too many claim submissions from this connection. Please try again later." },
      { status: 429 },
    );
  }

  const { session, admin } = await authenticate.public.appProxy(request);

  if (!session || !admin) {
    return Response.json({ error: "Unknown shop" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { orderNumber, confirmationCode, fullName, email, issueType, details, evidenceImage } =
    body as Record<string, unknown>;

  if (
    typeof orderNumber !== "string" ||
    !orderNumber.trim() ||
    typeof fullName !== "string" ||
    !fullName.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof issueType !== "string" ||
    !issueType.trim()
  ) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (typeof evidenceImage === "string" && evidenceImage.length > MAX_EVIDENCE_BASE64_CHARS) {
    return Response.json(
      { error: "That photo is too large. Please attach an image under 5MB." },
      { status: 413 },
    );
  }

  const order = await findOrderByNumberWithCache(admin, session.shop, orderNumber);
  if (!order) {
    return Response.json(
      {
        error:
          "We couldn't find that order number on this store. Please double-check it and try again.",
      },
      { status: 400 },
    );
  }

  if (order.email && order.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return Response.json(
      {
        error:
          "That email doesn't match the one used for this order. Please use the email from your order confirmation.",
      },
      { status: 400 },
    );
  }

  if (!order.shippedAt) {
    return Response.json(
      { error: "This order hasn't shipped yet — claims can be filed once it's on its way." },
      { status: 400 },
    );
  }

  const daysSinceShipped =
    (Date.now() - new Date(order.shippedAt).getTime()) / (1000 * 60 * 60 * 24);

  const settings = await db.merchantSettings.findUnique({ where: { shop: session.shop } });
  const windows = parseClaimWindows(settings?.claimWindows ?? "");
  const window = windows[issueType.trim()];

  if (window) {
    if (daysSinceShipped < window.minDays) {
      return Response.json(
        {
          error: `It's too early to file this type of claim — please wait until day ${Math.ceil(
            window.minDays,
          )} after shipping.`,
        },
        { status: 400 },
      );
    }
    if (daysSinceShipped > window.maxDays) {
      return Response.json(
        {
          error: `This claim type must be filed within ${window.maxDays} days of shipping — that window has passed.`,
        },
        { status: 400 },
      );
    }
  }

  let evidenceUrl: string | null = null;
  if (typeof evidenceImage === "string" && evidenceImage.startsWith("data:image/")) {
    evidenceUrl = await uploadEvidenceImage(admin, evidenceImage);
  }

  if (EVIDENCE_REQUIRED_TYPES.includes(issueType.trim()) && !evidenceUrl) {
    return Response.json(
      { error: "A photo is required for this claim type. Please attach one and try again." },
      { status: 400 },
    );
  }

  const riskLevel = await findOrderRiskLevel(admin, order.id);

  const claim = await db.protectionClaim.create({
    data: {
      shop: session.shop,
      orderNumber: orderNumber.trim(),
      confirmationCode:
        typeof confirmationCode === "string" ? confirmationCode.trim() : null,
      fullName: fullName.trim(),
      email: email.trim(),
      issueType: issueType.trim(),
      details: typeof details === "string" ? details.trim() : null,
      shopifyOrderId: order.id,
      shopifyOrderName: order.name,
      orderRiskLevel: riskLevel,
      evidenceUrl,
    },
  });

  notifyClaimSubmitted({
    email: claim.email,
    fullName: claim.fullName,
    orderNumber: claim.shopifyOrderName ?? claim.orderNumber,
    issueType: claim.issueType,
  });

  return Response.json({ id: claim.id, status: claim.status });
};
