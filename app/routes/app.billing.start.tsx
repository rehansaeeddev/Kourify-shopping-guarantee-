import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  authenticate,
  UNLIMITED_ANNUAL_PLAN,
  UNLIMITED_PLAN,
  USAGE_PLAN,
} from "../shopify.server";
import { getBillingState, isBillingTest } from "../lib/billing-state.server";

async function requestPlan(request: Request) {
  const { billing, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const formData = request.method === "POST" ? await request.formData() : null;
  const plan = String(formData?.get("plan") ?? url.searchParams.get("plan") ?? "");

  // Basic is free and has no Shopify plan, so "switching" to it means
  // cancelling the paid subscription. Prorated so the merchant is credited
  // for the unused part of the cycle rather than paying for time they lose.
  if (plan === "basic") {
    const { activeSubscriptionId } = await getBillingState(billing);
    if (activeSubscriptionId) {
      await billing.cancel({
        subscriptionId: activeSubscriptionId,
        isTest: isBillingTest(),
        prorate: true,
      });
    }
    throw redirect("/app/billing");
  }

  const selected =
    plan === "unlimited_annual"
      ? UNLIMITED_ANNUAL_PLAN
      : plan === "unlimited"
        ? UNLIMITED_PLAN
        : USAGE_PLAN;
  const returnUrl = new URL("/app/billing", process.env.SHOPIFY_APP_URL);
  returnUrl.searchParams.set("shop", session.shop);
  returnUrl.searchParams.set("embedded", "1");
  const host = url.searchParams.get("host");
  if (host) returnUrl.searchParams.set("host", host);

  await billing.request({
    plan: selected,
    isTest: isBillingTest(),
    returnUrl: returnUrl.toString(),
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => requestPlan(request);
export const action = async ({ request }: ActionFunctionArgs) => requestPlan(request);

export default function BillingRoute() {
  return null;
}
