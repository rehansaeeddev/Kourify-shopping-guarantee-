import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { findOrderRiskLevel } from "../lib/order-lookup.server";
import { findOrderByNumberWithCache } from "../lib/order-sync.server";
import {
  CLAIM_ISSUE_TYPES,
  parseClaimWindows,
  EVIDENCE_REQUIRED_TYPES,
} from "../lib/claim-window";
import { uploadEvidenceImage } from "../lib/upload-evidence.server";
import { isRateLimited, clientIpFromRequest } from "../lib/rate-limit.server";
import { notifyClaimSubmitted } from "../lib/notify.server";

const MAX_BODY_BYTES = 8 * 1024 * 1024; // ~8MB, enough headroom for a 5MB image base64-encoded
// 5 MB raw (what the client enforces and the UI promises), base64-inflated ~1.34x
// plus a little slack for the data: URI prefix. Keeps client and server in sync.
const MAX_EVIDENCE_BASE64_CHARS = Math.ceil((5 * 1024 * 1024 * 4) / 3) + 1024;

// Reads the request body while enforcing a hard byte cap. The Content-Length
// header can be absent (chunked transfer) or lie, so don't rely on it alone:
// pull the stream in chunks and abort the moment it exceeds the limit, bounding
// how much an unauthenticated storefront caller can make us buffer. Returns null
// when the cap is exceeded.
async function readBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json(
      { error: "That request is too large." },
      { status: 413 },
    );
  }

  const ip = clientIpFromRequest(request);
  // Scope the bucket by shop (from the app-proxy query) so that if the client
  // IP can't be determined, a shared "unknown" bucket only affects one shop
  // rather than locking every store's claim form at once.
  const shopParam =
    new URL(request.url).searchParams.get("shop") ?? "unknown";
  if (await isRateLimited(`claim:${shopParam}:${ip}`, 5, 10 * 60 * 1000)) {
    return Response.json(
      {
        error:
          "Too many claim submissions from this connection. Please try again later.",
      },
      { status: 429 },
    );
  }

  const { session, admin } = await authenticate.public.appProxy(request);

  if (!session || !admin) {
    return Response.json({ error: "Unknown shop" }, { status: 400 });
  }

  const rawBody = await readBodyWithinLimit(request, MAX_BODY_BYTES);
  if (rawBody === null) {
    return Response.json(
      { error: "That request is too large." },
      { status: 413 },
    );
  }
  let body: unknown = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const {
    orderNumber,
    confirmationCode,
    fullName,
    email,
    issueType,
    details,
    evidenceImage,
  } = body as Record<string, unknown>;

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

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedIssueType = issueType.trim();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    normalizedEmail.length > 254
  ) {
    return Response.json(
      { error: "Enter a valid email address" },
      { status: 400 },
    );
  }
  if (!CLAIM_ISSUE_TYPES.includes(normalizedIssueType)) {
    return Response.json({ error: "Invalid claim type" }, { status: 400 });
  }
  if (fullName.trim().length > 200 || orderNumber.trim().length > 100) {
    return Response.json(
      { error: "One or more fields are too long" },
      { status: 400 },
    );
  }
  if (
    typeof confirmationCode === "string" &&
    confirmationCode.trim().length > 200
  ) {
    return Response.json(
      { error: "Confirmation code is too long" },
      { status: 400 },
    );
  }
  if (typeof details === "string" && details.trim().length > 5_000) {
    return Response.json(
      { error: "Claim details must be 5,000 characters or fewer" },
      { status: 400 },
    );
  }

  if (
    typeof evidenceImage === "string" &&
    evidenceImage.length > MAX_EVIDENCE_BASE64_CHARS
  ) {
    return Response.json(
      { error: "That photo is too large. Please attach an image under 5MB." },
      { status: 413 },
    );
  }

  const order = await findOrderByNumberWithCache(
    admin,
    session.shop,
    orderNumber,
  );
  if (!order) {
    return Response.json(
      {
        error:
          "We couldn't find that order number on this store. Please double-check it and try again.",
      },
      { status: 400 },
    );
  }

  // Identity check: the submitter's email must match the order's email. If the
  // order has no email on file (e.g. POS/guest orders), we cannot verify the
  // submitter — reject rather than accept an unverifiable claim, otherwise
  // anyone who guesses an order number could file under any email.
  const orderEmail = order.email?.trim().toLowerCase() ?? "";
  if (!orderEmail) {
    return Response.json(
      {
        error:
          "We can't automatically verify this order. Please contact the store directly to file your claim.",
      },
      { status: 400 },
    );
  }
  if (orderEmail !== normalizedEmail) {
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
      {
        error:
          "This order hasn't shipped yet — claims can be filed once it's on its way.",
      },
      { status: 400 },
    );
  }

  const daysSinceShipped =
    (Date.now() - new Date(order.shippedAt).getTime()) / (1000 * 60 * 60 * 24);

  const settings = await db.merchantSettings.findUnique({
    where: { shop: session.shop },
  });
  const windows = parseClaimWindows(settings?.claimWindows ?? "");
  const window = windows[normalizedIssueType];

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
  if (
    typeof evidenceImage === "string" &&
    evidenceImage.startsWith("data:image/")
  ) {
    evidenceUrl = await uploadEvidenceImage(admin, evidenceImage);
  }

  if (EVIDENCE_REQUIRED_TYPES.includes(normalizedIssueType) && !evidenceUrl) {
    return Response.json(
      {
        error:
          "A photo is required for this claim type. Please attach one and try again.",
      },
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
      email: normalizedEmail,
      issueType: normalizedIssueType,
      details: typeof details === "string" ? details.trim() : null,
      shopifyOrderId: order.id,
      shopifyOrderName: order.name,
      orderRiskLevel: riskLevel,
      evidenceUrl,
    },
  });

  await notifyClaimSubmitted({
    email: claim.email,
    fullName: claim.fullName,
    orderNumber: claim.shopifyOrderName ?? claim.orderNumber,
    issueType: claim.issueType,
  });

  return Response.json({ id: claim.id, status: claim.status });
};
