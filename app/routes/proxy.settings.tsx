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
  protectionEnabled: false,
  protectionVariantId: null as string | null,
  protectionVariantLegacyId: null as string | null,
  currency: "USD",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = { "Access-Control-Allow-Origin": "*" };

  const ip = clientIpFromRequest(request);
  // Scope by shop so an undeterminable client IP can't lock out every store.
  const shopParam =
    new URL(request.url).searchParams.get("shop") ?? "unknown";
  if (await isRateLimited(`settings:${shopParam}:${ip}`, 60, 60 * 1000)) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: corsHeaders },
    );
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json(DEFAULT_SETTINGS, { headers: corsHeaders });
  }

  const settings = await db.merchantSettings.findUnique({
    where: { shop: session.shop },
  });
  if (!settings) {
    return Response.json(DEFAULT_SETTINGS, { headers: corsHeaders });
  }

  return Response.json(
    {
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
      protectionEnabled: settings.protectionEnabled,
      protectionVariantId: settings.protectionVariantId,
      protectionVariantLegacyId:
        settings.protectionVariantId?.split("/").pop() ?? null,
      currency: settings.currency,
    },
    { headers: corsHeaders },
  );
};
