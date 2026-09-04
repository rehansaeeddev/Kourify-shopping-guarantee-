import db from "../db.server";

type WebhookLineItem = {
  title?: string;
  quantity?: number;
  price?: string;
  properties?:
    Array<{ name?: string; value?: string }> | Record<string, string>;
};

function isProtectionLine(line: WebhookLineItem): boolean {
  if (line.title === "Kourify Order Protection") return true;
  const properties = Array.isArray(line.properties)
    ? line.properties
    : Object.entries(line.properties ?? {}).map(([name, value]) => ({
        name,
        value,
      }));
  return properties.some(
    (property) =>
      property.name === "_kourify_protection" && property.value === "true",
  );
}

export async function recordProtectionSelection(
  shop: string,
  order: Record<string, unknown>,
) {
  const orderId = String(order.admin_graphql_api_id ?? order.id ?? "");
  if (!orderId) return null;

  const financialStatus = String(order.financial_status ?? "").toLowerCase();
  if (financialStatus !== "paid") return null;

  const settings = await db.merchantSettings.findUnique({ where: { shop } });
  const protectionLine = (
    (order.line_items as WebhookLineItem[] | undefined) ?? []
  ).find(isProtectionLine);

  // An order becomes protected two ways:
  //  1. The customer selected the protection line at checkout (customer-pays).
  //  2. The merchant covers protection for every order (merchant-pays): there's
  //     no line item and no customer charge, but the order is still protected
  //     and still incurs the per-order usage fee that Kourify bills the merchant.
  const merchantPays =
    Boolean(settings?.protectionEnabled) &&
    settings?.protectionPayer === "merchant";

  if (!protectionLine && !merchantPays) {
    return null;
  }

  const customerSelected = Boolean(protectionLine);
  const priceCents = protectionLine
    ? Math.round(Number(protectionLine.price ?? 0) * 100) *
      Math.max(1, Number(protectionLine.quantity ?? 1))
    : 0; // merchant-pays: no customer-facing charge

  const currency = String(order.currency ?? settings?.currency ?? "USD");
  const protectedOrder = await db.protectedOrder.upsert({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: orderId } },
    update: {
      shopifyOrderName: String(order.name ?? ""),
      protectionPriceCents: priceCents,
      currency,
      customerSelected,
    },
    create: {
      shop,
      shopifyOrderId: orderId,
      shopifyOrderName: String(order.name ?? ""),
      protectionPriceCents: priceCents,
      currency,
      customerSelected,
    },
  });

  await db.protectionOffer.updateMany({
    where: { shop, originalOrderId: orderId, status: "awaiting_payment" },
    data: { status: "payment_confirmed", protectionPurchaseId: orderId },
  });

  return db.usageEvent.upsert({
    where: {
      protectedOrderId_eventType: {
        protectedOrderId: protectedOrder.id,
        eventType: "protected_order",
      },
    },
    update: {},
    create: {
      shop,
      protectedOrderId: protectedOrder.id,
      amountCents: settings?.plan === "unlimited" ? 0 : 60,
      status: settings?.plan === "unlimited" ? "waived" : "pending",
    },
  });
}

export async function getProtectionAnalytics(shop: string) {
  const [protectedOrders, usage, revenue] = await Promise.all([
    db.protectedOrder.count({ where: { shop, customerSelected: true } }),
    // Only count fees actually charged — pending/failed/waived events would
    // otherwise inflate the reported usage total.
    db.usageEvent.aggregate({
      where: { shop, status: "billed" },
      _sum: { amountCents: true },
    }),
    db.protectedOrder.aggregate({
      where: { shop, customerSelected: true },
      _sum: { protectionPriceCents: true },
    }),
  ]);
  const totalOrders = await db.order.count({ where: { shop } });

  return {
    protectedOrders,
    totalOrders,
    conversionRate: totalOrders ? (protectedOrders / totalOrders) * 100 : 0,
    protectionRevenueCents: revenue._sum.protectionPriceCents ?? 0,
    usageFeesCents: usage._sum.amountCents ?? 0,
  };
}
