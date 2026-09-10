import db from "../db.server";
import {
  buildCoverageLines,
  coveredMerchandiseCents,
  type OrderLine,
} from "./coverage.server";
import {
  planAllowsCustomerPays,
  planProtectedOrderLimit,
  planWaivesUsageFee,
  type PlanId,
} from "./plans";

/**
 * Serializable transactions can abort on a lock conflict or deadlock when two
 * webhooks contend for the last slot. That's the isolation level doing its
 * job — one caller retries and then correctly sees the slot as taken.
 */
async function withSerializableRetry<T>(
  run: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}

type WebhookLineItem = OrderLine;

export const PROTECTION_LINE_TITLE = "Kourify Order Protection";

/** Shopify sends variant ids as numbers on REST payloads, GIDs elsewhere. */
function legacyVariantId(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value);
  const tail = raw.split("/").pop();
  return tail && /^\d+$/.test(tail) ? tail : null;
}

/**
 * Identifies the protection line on an order.
 *
 * Trust order matters here. The line's title and its `_kourify_protection`
 * property both travel through the public Ajax Cart API, so a shopper can put
 * either on any cheap line item. Neither is accepted as proof on its own:
 *
 *  1. **Configured variant** — the line's variant matches the shop's own
 *     `protectionVariantId`. This is the only self-sufficient signal.
 *  2. **Accepted post-purchase offer** — the offer flow adds a *custom* item
 *     via `orderEditAddCustomItem`, which carries no variant, so a title match
 *     counts only when this shop has an offer for this order that reached
 *     `awaiting_payment` or beyond.
 *
 * The client-supplied property is now only a hint for logging, never a grant.
 */
function findProtectionLine(
  lines: WebhookLineItem[],
  configuredVariantId: string | null,
  hasAcceptedOffer: boolean,
): WebhookLineItem | null {
  const configuredLegacy = legacyVariantId(configuredVariantId);

  if (configuredLegacy) {
    const byVariant = lines.find(
      (line) => legacyVariantId(line.variant_id) === configuredLegacy,
    );
    if (byVariant) return byVariant;
  }

  if (hasAcceptedOffer) {
    const byOfferTitle = lines.find(
      (line) =>
        line.title === PROTECTION_LINE_TITLE &&
        legacyVariantId(line.variant_id) === null,
    );
    if (byOfferTitle) return byOfferTitle;
  }

  return null;
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

  const orderLines = (order.line_items as WebhookLineItem[] | undefined) ?? [];
  // The offer flow adds a variant-less custom item, so a title match is only
  // honoured when this shop genuinely offered protection on this order.
  const acceptedOffer = await db.protectionOffer.findFirst({
    where: {
      shop,
      originalOrderId: orderId,
      status: { in: ["awaiting_payment", "payment_confirmed"] },
    },
    select: { id: true },
  });
  const protectionLine = findProtectionLine(
    orderLines,
    settings?.protectionVariantId ?? null,
    Boolean(acceptedOffer),
  );

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

  const plan = (settings?.plan ?? "basic") as PlanId;
  const limit = planProtectedOrderLimit(plan);

  const customerSelected = Boolean(protectionLine);
  // Protection is sold once per order — the storefront always adds quantity 1.
  // Recording price × quantity let an order edit (or a modified cart call)
  // multiply the recorded protection revenue, so the unit price is taken alone
  // regardless of what quantity the line claims.
  const priceCents = protectionLine
    ? Math.max(0, Math.round(Number(protectionLine.price ?? 0) * 100))
    : 0; // merchant-pays: no customer-facing charge

  // Did the shopper actually pay for this protection?
  const customerPaidForProtection = customerSelected && priceCents > 0;

  // A capped plan is merchant-pays only, and its protection variant is priced
  // at 0 and its id withheld from the storefront — so a paid line should be
  // impossible here. If one arrives anyway (variant price edited by hand in
  // Shopify, or an order placed before a plan change), the money has already
  // been taken and the coverage is honoured below. Log it loudly: it means a
  // guard upstream didn't hold, not that this order is unusual.
  if (customerPaidForProtection && !planAllowsCustomerPays(plan)) {
    console.warn(
      `[kourify] ${shop}: customer-paid protection on plan "${plan}", which should be merchant-pays only. Order ${orderId}, ${priceCents} cents. Honouring the charge — check the protection variant's price.`,
    );
  }

  const currency = String(order.currency ?? settings?.currency ?? "USD");

  // Item-level coverage. Each merchandise line is measured against the
  // merchant's eligibility ceiling as it stands right now; the ceiling is
  // snapshotted onto the order so a later settings change can't retroactively
  // widen or narrow coverage that has already been sold.
  const maxEligible = settings?.maxEligibleItemValueCents ?? null;
  // Exclude the identified protection line itself — protection is not
  // merchandise and can't be claimed against. Compared by identity so a
  // shopper-supplied title or property can't exclude a real product line.
  const coverageLines = buildCoverageLines(
    orderLines,
    (line) => line === protectionLine,
    maxEligible,
  );
  const merchandiseCents = coveredMerchandiseCents(coverageLines);

  // Allowance claim and row creation happen together, inside one serializable
  // transaction, so two concurrent webhooks can't both read the same free slot
  // and both insert. Reading the count and inserting separately — even
  // milliseconds apart — is exactly the read-then-write race this replaces.
  //
  // The claim only gates coverage nobody paid for. Protection a customer has
  // already been charged for is always honoured: Shopify offers no hook to
  // stop that charge, so refusing here would take their money and give nothing
  // back. Capped plans are merchant-pays only (planAllowsCustomerPays), so in
  // practice this only fires for carts that predate a plan or payer change.
  const protectedOrder = await withSerializableRetry(() =>
    db.$transaction(
      async (tx) => {
        const existing = await tx.protectedOrder.findUnique({
          where: { shop_shopifyOrderId: { shop, shopifyOrderId: orderId } },
          select: { id: true },
        });

        // Idempotency: an order that already holds a slot never consumes a
        // second one, however many times the webhook is replayed.
        if (!existing && limit !== null && !customerPaidForProtection) {
          const used = await tx.protectedOrder.count({
            where: { shop, revokedAt: null },
          });
          if (used >= limit) return null;
        }

        return tx.protectedOrder.upsert({
          where: { shop_shopifyOrderId: { shop, shopifyOrderId: orderId } },
          update: {
            shopifyOrderName: String(order.name ?? ""),
            protectionPriceCents: priceCents,
            coveredMerchandiseCents: merchandiseCents,
            currency,
            customerSelected,
            // Protection is present again on a paid order, so any earlier
            // revocation no longer applies (refunded, then re-purchased).
            revokedAt: null,
            revokedReason: null,
          },
          create: {
            shop,
            shopifyOrderId: orderId,
            shopifyOrderName: String(order.name ?? ""),
            protectionPriceCents: priceCents,
            coveredMerchandiseCents: merchandiseCents,
            maxEligibleItemValueCents: maxEligible,
            currency,
            customerSelected,
          },
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );

  if (!protectedOrder) {
    console.log(
      `[kourify] ${shop} is at its ${plan} allowance (${limit}); ${orderId} not protected (no customer charge to honour).`,
    );
    return null;
  }

  // Upsert per line so a re-delivered or late webhook refreshes values without
  // duplicating rows or orphaning a claim that already points at an item.
  for (const line of coverageLines) {
    await db.protectedOrderItem.upsert({
      where: {
        protectedOrderId_lineItemId: {
          protectedOrderId: protectedOrder.id,
          lineItemId: line.lineItemId,
        },
      },
      update: {
        title: line.title,
        variantId: line.variantId,
        sku: line.sku,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        eligible: line.eligible,
      },
      create: {
        shop,
        protectedOrderId: protectedOrder.id,
        lineItemId: line.lineItemId,
        title: line.title,
        variantId: line.variantId,
        sku: line.sku,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        eligible: line.eligible,
      },
    });
  }

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
      // Basic is free and both Unlimited plans are flat-rate, so the per-order
      // fee only applies on Usage. The event is still written on waived plans
      // so protected-order history stays complete.
      amountCents: planWaivesUsageFee(plan) ? 0 : 60,
      status: planWaivesUsageFee(plan) ? "waived" : "pending",
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
