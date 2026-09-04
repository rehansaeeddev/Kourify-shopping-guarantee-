import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, UNLIMITED_PLAN, USAGE_PLAN } from "../shopify.server";
import { isBillingTest } from "../lib/billing-state.server";

async function requestPlan(request: Request) {
  const { billing, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const formData = request.method === "POST" ? await request.formData() : null;
  const plan = formData?.get("plan") ?? url.searchParams.get("plan");
  const selected = plan === "unlimited" ? UNLIMITED_PLAN : USAGE_PLAN;
  const returnUrl = new URL("/app/protection", process.env.SHOPIFY_APP_URL);
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
