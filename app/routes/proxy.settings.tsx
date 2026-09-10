import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isRateLimited, clientIpFromRequest } from "../lib/rate-limit.server";
import { getProtectionQuota } from "../lib/plan-limits.server";
import { planAllowsCustomerPays, type PlanId } from "../lib/plans";

const DEFAULT_SETTINGS = {
  badgesEnabled: false,
  badgeStyle: "classic",
  showOnProduct: true,
  showOnCart: true,
  guaranteeTabPosition: "right",
  protectionPayer: "customer",
  enabledClaimTypes: [] as string[],
  protectionFeeType: "flat",
  protectionFlatFeeCents: 299,
  protectionPercentBasisPoints: 200,
  protectionMinFeeCents: 99,
  protectionMaxFeeCents: 999,
  // Coverage ceiling, distinct from the fee fields above. null = no ceiling.
  maxEligibleItemValueCents: null as number | null,
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

  // Customer-pays is Plus-only. If the stored plan tier is a known non-Plus
  // value, report merchant-pays to the storefront so widgets never offer a
  // customer charge even if the saved payer is still "customer" (e.g. set
  // before the store's plan was detected). "unknown" keeps the saved value.
  const nonPlus =
    settings.planTier === "standard" || settings.planTier === "dev";
  // A capped plan can't guarantee a slot will still be free by the time the
  // charge lands, so it never offers paid protection — see planAllowsCustomerPays.
  const planPaysOnly = !planAllowsCustomerPays((settings.plan ?? "basic") as PlanId);
  const protectionPayer =
    nonPlus || planPaysOnly ? "merchant" : settings.protectionPayer;

  // Basic plan allowance. Once a free shop has protected its quota, the
  // storefront stops offering protection — the widget hides rather than
  // letting a shopper select coverage the backend would then refuse.
  const quota = await getProtectionQuota(
    session.shop,
    (settings.plan ?? "basic") as PlanId,
  );
  const protectionEnabled = settings.protectionEnabled && !quota.exhausted;

  return Response.json(
    {
      badgesEnabled: settings.badgesEnabled,
      badgeStyle: settings.badgeStyle,
      showOnProduct: settings.showOnProduct,
      showOnCart: settings.showOnCart,
      guaranteeTabPosition: settings.guaranteeTabPosition,
      protectionPayer,
      enabledClaimTypes: settings.enabledClaimTypes.split(",").filter(Boolean),
      protectionFeeType: settings.protectionFeeType,
      protectionFlatFeeCents: settings.protectionFlatFeeCents,
      protectionPercentBasisPoints: settings.protectionPercentBasisPoints,
      protectionMinFeeCents: settings.protectionMinFeeCents,
      protectionMaxFeeCents: settings.protectionMaxFeeCents,
      maxEligibleItemValueCents: settings.maxEligibleItemValueCents,
      protectionEnabled,
      // Only handed out when the customer is actually meant to buy a
      // protection line. On merchant-pays there is no line to add, and
      // publishing the id would just tell a shopper what to POST to
      // /cart/add.js. Defence in depth — the variant is also priced at 0 in
      // that mode, so injecting it costs nothing.
      protectionVariantId: protectionPayer === "customer"
        ? settings.protectionVariantId
        : null,
      protectionVariantLegacyId:
        protectionPayer === "customer"
          ? (settings.protectionVariantId?.split("/").pop() ?? null)
          : null,
      currency: settings.currency,
    },
    { headers: corsHeaders },
  );
};
