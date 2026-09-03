import { createHash, randomBytes } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";

import { AppButton } from "../components/AppButton";
import { Card, StatTile } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import db from "../db.server";
import { sendProtectionOffer } from "../lib/notify.server";
import { authenticate } from "../shopify.server";
import { useFetcherToast } from "../hooks/useFetcherToast";

const FILTERS = ["all", "protected", "unprotected"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const requestedFilter = new URL(request.url).searchParams.get("filter");
  const filter = FILTERS.includes(requestedFilter as (typeof FILTERS)[number])
    ? requestedFilter
    : "all";

  const [orders, protectedOrders, offers, settings] = await Promise.all([
    db.order.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.protectedOrder.findMany({
      where: { shop: session.shop },
      select: {
        shopifyOrderId: true,
        protectionPriceCents: true,
        currency: true,
      },
    }),
    db.protectionOffer.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
    }),
    db.merchantSettings.findUnique({ where: { shop: session.shop } }),
  ]);
  const currency = settings?.currency ?? "USD";
  const protectedById = new Map(
    protectedOrders.map((order) => [order.shopifyOrderId, order]),
  );
  const latestOffers = new Map<string, (typeof offers)[number]>();
  for (const offer of offers) {
    if (!latestOffers.has(offer.originalOrderId))
      latestOffers.set(offer.originalOrderId, offer);
  }
  const rows = orders
    .map((order) => {
      const protectedOrder = protectedById.get(order.id) ?? null;
      const offer = latestOffers.get(order.id) ?? null;
      return {
        ...order,
        protected: Boolean(protectedOrder),
        protectionPriceCents: protectedOrder?.protectionPriceCents ?? null,
        protectionCurrency: protectedOrder?.currency ?? currency,
        offerStatus: offer?.status ?? null,
        offerExpiresAt: offer?.expiresAt?.toISOString() ?? null,
      };
    })
    .filter((order) => {
      if (filter === "protected") return order.protected;
      if (filter === "unprotected") return !order.protected;
      return true;
    });

  return {
    rows,
    filter,
    currency,
    counts: {
      all: orders.length,
      protected: orders.filter((order) => protectedById.has(order.id)).length,
      unprotected: orders.filter((order) => !protectedById.has(order.id))
        .length,
    },
  };
};

const handleAction = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (!["send_offer", "fulfill", "deliver"].includes(intent)) {
    return { ok: false, error: "Unknown action." };
  }

  const orderId = String(formData.get("orderId") ?? "");
  const order = await db.order.findFirst({
    where: { id: orderId, shop: session.shop },
  });
  if (!order) return { ok: false, error: "Order not found." };

  if (intent === "fulfill") {
    if (formData.get("confirmed") !== "true") {
      return { ok: false, error: "Confirm fulfillment before continuing." };
    }
    const protectedOrder = await db.protectedOrder.findUnique({
      where: {
        shop_shopifyOrderId: { shop: session.shop, shopifyOrderId: order.id },
      },
    });
    if (!protectedOrder)
      return { ok: false, error: "Payment-confirmed protection is required." };
    const response = await admin.graphql(
      `#graphql
        query kourifyFulfillmentOrders($id: ID!) {
          order(id: $id) {
            fulfillmentOrders(first: 20) {
              nodes { id status assignedLocation { location { id } } }
            }
          }
        }`,
      { variables: { id: order.id } },
    );
    const json = await response.json();
    const fulfillmentOrders = (
      json.data?.order?.fulfillmentOrders?.nodes ?? []
    ).filter(
      (item: { status?: string }) =>
        !["CLOSED", "CANCELLED"].includes(item.status ?? ""),
    );
    if (!fulfillmentOrders.length)
      return { ok: false, error: "No fulfillable items remain." };
    const groups = new Map<string, string[]>();
    for (const item of fulfillmentOrders as Array<{
      id: string;
      assignedLocation?: { location?: { id?: string } };
    }>) {
      const locationId = item.assignedLocation?.location?.id ?? item.id;
      groups.set(locationId, [...(groups.get(locationId) ?? []), item.id]);
    }
    const trackingNumber = String(formData.get("trackingNumber") ?? "").trim();
    const trackingCompany = String(
      formData.get("trackingCompany") ?? "",
    ).trim();
    const trackingUrl = String(formData.get("trackingUrl") ?? "").trim();
    for (const fulfillmentOrderIds of groups.values()) {
      const mutationResponse = await admin.graphql(
        `#graphql
          mutation kourifyFulfill($fulfillment: FulfillmentInput!) {
            fulfillmentCreate(fulfillment: $fulfillment) {
              fulfillment { id status }
              userErrors { field message }
            }
          }`,
        {
          variables: {
            fulfillment: {
              notifyCustomer: formData.get("notifyCustomer") === "true",
              lineItemsByFulfillmentOrder: fulfillmentOrderIds.map(
                (fulfillmentOrderId) => ({
                  fulfillmentOrderId,
                }),
              ),
              ...(trackingNumber
                ? {
                    trackingInfo: {
                      number: trackingNumber,
                      ...(trackingCompany ? { company: trackingCompany } : {}),
                      ...(trackingUrl ? { url: trackingUrl } : {}),
                    },
                  }
                : {}),
            },
          },
        },
      );
      const mutationJson = await mutationResponse.json();
      const errors = mutationJson.data?.fulfillmentCreate?.userErrors ?? [];
      if (errors.length)
        throw new Error(
          errors.map((error: { message: string }) => error.message).join("; "),
        );
    }
    await db.order.update({
      where: { id: order.id },
      data: { status: "fulfilled" },
    });
    return { ok: true, message: `${order.name} was fulfilled.` };
  }

  if (intent === "deliver") {
    if (formData.get("confirmed") !== "true") {
      return { ok: false, error: "Confirm actual delivery before continuing." };
    }
    const response = await admin.graphql(
      `#graphql
        query kourifyOrderFulfillments($id: ID!) {
          order(id: $id) { fulfillments(first: 20) { id status } }
        }`,
      { variables: { id: order.id } },
    );
    const json = await response.json();
    const fulfillments = json.data?.order?.fulfillments ?? [];
    if (!fulfillments.length)
      return { ok: false, error: "Create a fulfillment first." };
    for (const fulfillment of fulfillments as Array<{ id: string }>) {
      const eventResponse = await admin.graphql(
        `#graphql
          mutation kourifyDelivered($event: FulfillmentEventInput!) {
            fulfillmentEventCreate(fulfillmentEvent: $event) {
              fulfillmentEvent { id status }
              userErrors { field message }
            }
          }`,
        {
          variables: {
            event: { fulfillmentId: fulfillment.id, status: "DELIVERED" },
          },
        },
      );
      const eventJson = await eventResponse.json();
      const errors = eventJson.data?.fulfillmentEventCreate?.userErrors ?? [];
      if (errors.length)
        throw new Error(
          errors.map((error: { message: string }) => error.message).join("; "),
        );
    }
    await db.order.update({
      where: { id: order.id },
      data: { deliveredAt: new Date() },
    });
    return { ok: true, message: `${order.name} was marked delivered.` };
  }

  if (!order || !order.email)
    return { ok: false, error: "This order has no customer email." };
  if (isOrderFulfilled(order.status)) {
    return {
      ok: false,
      error: "Protection offers are only available before fulfillment.",
    };
  }
  const alreadyProtected = await db.protectedOrder.findUnique({
    where: {
      shop_shopifyOrderId: { shop: session.shop, shopifyOrderId: order.id },
    },
  });
  if (alreadyProtected)
    return { ok: false, error: "This order is already protected." };

  const settings = await db.merchantSettings.findUnique({
    where: { shop: session.shop },
  });
  if (!settings?.protectionEnabled || !settings.protectionVariantId) {
    return {
      ok: false,
      error: "Enable protection and create its product before sending offers.",
    };
  }
  const orderCents = Math.round(Number(order.totalPrice ?? 0) * 100);
  const priceCents =
    settings.protectionFeeType === "percentage"
      ? Math.min(
          Math.max(
            Math.round(
              (orderCents * settings.protectionPercentBasisPoints) / 10_000,
            ),
            settings.protectionMinFeeCents,
          ),
          settings.protectionMaxFeeCents,
        )
      : settings.protectionFlatFeeCents;
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const offer = await db.protectionOffer.create({
    data: {
      shop: session.shop,
      originalOrderId: order.id,
      originalOrderName: order.name,
      customerEmail: order.email,
      tokenHash,
      status: "offer_sent",
      protectionPriceCents: priceCents,
      currency: settings.currency,
      expiresAt,
    },
  });

  try {
    await sendProtectionOffer({
      email: order.email,
      orderName: order.name,
      price: new Intl.NumberFormat("en", {
        style: "currency",
        currency: settings.currency,
      }).format(priceCents / 100),
      expiresAt,
      offerUrl: `https://${session.shop}/apps/kourify/offer?token=${encodeURIComponent(rawToken)}`,
    });
  } catch (error) {
    await db.protectionOffer.delete({ where: { id: offer.id } });
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The offer email could not be sent.",
    };
  }

  return { ok: true, message: `Protection offer sent for ${order.name}.` };
};

export const action = async (args: ActionFunctionArgs) => {
  try {
    return await handleAction(args);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Shopify could not complete this action.";
    if (
      message.includes("fulfillmentEventCreate") ||
      message.includes("write_fulfillments")
    ) {
      return {
        ok: false,
        error:
          "Delivery could not be updated. Reapprove the app's write_fulfillments scope and make sure your Shopify staff account has the Fulfill and ship orders permission.",
      };
    }
    if (message.toLowerCase().includes("access denied")) {
      return {
        ok: false,
        error:
          "Shopify denied this action. Reapprove the app permissions and check your staff permissions.",
      };
    }
    console.error("[orders action] failed", error);
    return { ok: false, error: message };
  }
};

function isOrderFulfilled(status: string): boolean {
  // Guard against the substring trap: "unfulfilled" contains "fulfilled".
  const normalized = status.toLowerCase();
  return normalized.includes("fulfilled") && !normalized.includes("unfulfilled");
}

function fulfillmentLabel(status: string): string {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function protectionLabel(
  protectedOrder: boolean,
  offerStatus: string | null,
): string {
  if (protectedOrder) return "Protection paid";
  if (offerStatus === "awaiting_payment") return "Awaiting payment";
  if (offerStatus === "offer_sent") return "Offer sent";
  return "Not protected";
}

function formatMoney(
  amount: string | number | null | undefined,
  currency: string,
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(value);
}

function offerExpiryLabel(iso: string | null): string | null {
  if (!iso) return null;
  const remainingMs = new Date(iso).getTime() - Date.now();
  if (remainingMs <= 0) return "Offer expired";
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  return hours >= 1
    ? `Expires in ${hours}h ${minutes}m`
    : `Expires in ${minutes}m`;
}

export default function Orders() {
  const { rows, filter, counts, currency } = useLoaderData<typeof loader>();
  const offerFetcher = useFetcher<typeof action>();
  const [fulfillmentOrder, setFulfillmentOrder] = useState<{
    id: string;
    name: string;
  } | null>(null);
  useFetcherToast(
    offerFetcher,
    (data) => data.message ?? data.error ?? "Offer updated.",
  );

  return (
    <s-page>
      <PageHeader
        title="Orders"
        subtitle="See which Shopify orders include Kourify protection and which remain unprotected."
        actions={
          <AppButton href="/app/order-sync" variant="secondary">
            Sync orders
          </AppButton>
        }
      />

      <div className="app-card-row" style={{ marginBlock: "1.25rem" }}>
        <StatTile icon="order" label="Orders" value={String(counts.all)} />
        <StatTile
          icon="shield-check-mark"
          label="Protected"
          tone="success"
          value={String(counts.protected)}
        />
        <StatTile
          icon="alert-circle"
          label="Not protected"
          tone={counts.unprotected ? "warning" : "default"}
          value={String(counts.unprotected)}
        />
      </div>

      <Card heading="Shopify orders">
        <s-stack direction="inline" gap="small-200" paddingBlockEnd="base">
          {FILTERS.map((value) => (
            <AppButton
              key={value}
              variant={filter === value ? "primary" : "secondary"}
              href={
                value === "all" ? "/app/orders" : `/app/orders?filter=${value}`
              }
            >
              {value === "all"
                ? "All"
                : value === "protected"
                  ? "Protected"
                  : "Not protected"}
            </AppButton>
          ))}
        </s-stack>

        {rows.length === 0 ? (
          <EmptyState
            icon="order"
            heading="No orders here"
            description="Synchronize orders or choose another protection filter."
          />
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Total</s-table-header>
              <s-table-header>Fulfillment</s-table-header>
              <s-table-header>Protection</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((order) => {
                const orderId = order.id.split("/").pop();
                const isFulfilled = isOrderFulfilled(order.status);
                return (
                  <s-table-row key={order.id}>
                    <s-table-cell>{order.name}</s-table-cell>
                    <s-table-cell>
                      {order.customerName || order.email ? (
                        <s-stack direction="block" gap="small-100">
                          {order.customerName ? (
                            <s-text>{order.customerName}</s-text>
                          ) : null}
                          {order.email ? (
                            <s-text color="subdued">{order.email}</s-text>
                          ) : null}
                        </s-stack>
                      ) : (
                        "Customer details unavailable"
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {formatMoney(order.totalPrice, currency)}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-100">
                        <s-text>{fulfillmentLabel(order.status)}</s-text>
                        {order.deliveredAt ? (
                          <s-badge tone="success">Delivered</s-badge>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-100">
                        <s-badge tone={order.protected ? "success" : "warning"}>
                          {protectionLabel(order.protected, order.offerStatus)}
                        </s-badge>
                        {order.protected &&
                        order.protectionPriceCents != null ? (
                          <s-text color="subdued">
                            {formatMoney(
                              order.protectionPriceCents / 100,
                              order.protectionCurrency,
                            )}
                          </s-text>
                        ) : null}
                        {!order.protected &&
                        order.offerStatus === "offer_sent" &&
                        order.offerExpiresAt ? (
                          <s-text color="subdued">
                            {offerExpiryLabel(order.offerExpiresAt)}
                          </s-text>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <AppButton
                          href={`shopify://admin/orders/${orderId}`}
                          variant="secondary"
                        >
                          View
                        </AppButton>
                        {!order.protected &&
                        !isFulfilled &&
                        order.email &&
                        !["offer_sent", "awaiting_payment"].includes(
                          order.offerStatus ?? "",
                        ) ? (
                          <AppButton
                            variant="primary"
                            disabled={offerFetcher.state !== "idle"}
                            onClick={() =>
                              offerFetcher.submit(
                                { intent: "send_offer", orderId: order.id },
                                { method: "POST" },
                              )
                            }
                          >
                            Send offer
                          </AppButton>
                        ) : null}
                        {order.protected && !isFulfilled ? (
                          <AppButton
                            variant="primary"
                            onClick={() => setFulfillmentOrder(order)}
                          >
                            Fulfill order
                          </AppButton>
                        ) : null}
                        {order.protected &&
                        isFulfilled &&
                        !order.deliveredAt ? (
                          <AppButton
                            variant="secondary"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Confirm that ${order.name} was actually delivered?`,
                                )
                              ) {
                                offerFetcher.submit(
                                  {
                                    intent: "deliver",
                                    orderId: order.id,
                                    confirmed: "true",
                                  },
                                  { method: "POST" },
                                );
                              }
                            }}
                          >
                            Mark as delivered
                          </AppButton>
                        ) : null}
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </Card>
      {fulfillmentOrder ? (
        <Card heading={`Fulfill ${fulfillmentOrder.name}`}>
          <offerFetcher.Form method="post">
            <input type="hidden" name="intent" value="fulfill" />
            <input type="hidden" name="orderId" value={fulfillmentOrder.id} />
            <input type="hidden" name="confirmed" value="true" />
            <s-stack gap="base">
              <s-text-field label="Tracking number" name="trackingNumber" />
              <s-text-field label="Shipping carrier" name="trackingCompany" />
              <s-text-field label="Tracking URL" name="trackingUrl" />
              <s-checkbox
                label="Notify the customer"
                name="notifyCustomer"
                value="true"
                checked
              />
              <s-banner tone="warning">
                Confirm only when the order is packed and ready to be fulfilled.
                Protection payment never fulfills an order automatically.
              </s-banner>
              <s-stack direction="inline" gap="small-200">
                <AppButton type="submit" variant="primary">
                  Confirm fulfillment
                </AppButton>
                <AppButton
                  variant="secondary"
                  onClick={() => setFulfillmentOrder(null)}
                >
                  Cancel
                </AppButton>
              </s-stack>
            </s-stack>
          </offerFetcher.Form>
        </Card>
      ) : null}
    </s-page>
  );
}
