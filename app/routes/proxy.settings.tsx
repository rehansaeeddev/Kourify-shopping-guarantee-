import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isRateLimited, clientIpFromRequest } from "../lib/rate-limit.server";

const DEFAULT_SETTINGS = {
  badgesEnabled: false,
  badgeStyle: "classic",
  showOnProduct: true,
  showOnCart: true,
  protectionPayer: "customer",
  enabledClaimTypes: [] as string[],
  protectionFeeType: "flat",
  protectionFlatFeeCents: 299,
  protectionPercentBasisPoints: 200,
  protectionMinFeeCents: 99,
  protectionMaxFeeCents: 999,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ip = clientIpFromRequest(request);
  if (isRateLimited(`settings:${ip}`, 60, 60 * 1000)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json(DEFAULT_SETTINGS);
  }

  const settings = await db.merchantSettings.findUnique({
    where: { shop: session.shop },
  });
  if (!settings) {
    return Response.json(DEFAULT_SETTINGS);
  }

  return Response.json({
    badgesEnabled: settings.badgesEnabled,
    badgeStyle: settings.badgeStyle,
    showOnProduct: settings.showOnProduct,
    showOnCart: settings.showOnCart,
    protectionPayer: settings.protectionPayer,
    enabledClaimTypes: settings.enabledClaimTypes.split(",").filter(Boolean),
    protectionFeeType: settings.protectionFeeType,
    protectionFlatFeeCents: settings.protectionFlatFeeCents,
    protectionPercentBasisPoints: settings.protectionPercentBasisPoints,
    protectionMinFeeCents: settings.protectionMinFeeCents,
    protectionMaxFeeCents: settings.protectionMaxFeeCents,
  });
};
