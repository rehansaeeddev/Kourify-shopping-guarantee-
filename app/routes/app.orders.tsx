import { createHash, randomBytes } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";

import { AppButton } from "../components/AppButton";
import { Card, StatTile } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import db from "../db.server";
import { sendProtectionOffer } from "../lib/notify.server";
import { isRateLimited } from "../lib/rate-limit.server";
import { authenticate } from "../shopify.server";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import { getWorkspaceCounts } from "../lib/workspace-counts.server";
import { useFetcherToast } from "../hooks/useFetcherToast";

const FILTERS = ["all", "protected", "unprotected"] as const;
const PAGE_SIZES = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const requestedFilter = url.searchParams.get("filter");
  const filter: (typeof FILTERS)[number] = FILTERS.includes(
    requestedFilter as (typeof FILTERS)[number],
  )
    ? (requestedFilter as (typeof FILTERS)[number])
    : "all";
  const page = Math.max(
    1,
    Math.floor(Number(url.searchParams.get("page")) || 1),
  );
  const requestedPageSize = Number(url.searchParams.get("pageSize"));
  const pageSize = PAGE_SIZES.includes(
    requestedPageSize as (typeof PAGE_SIZES)[number],
  )
    ? requestedPageSize
    : DEFAULT_PAGE_SIZE;

  // ProtectedOrder has no FK/relation to Order (just a shared shopifyOrderId),
  // so "protected"/"unprotected" filtering goes through an id list rather
  // than a join. This full scan is bounded by protected-order count, not
  // total order count, so it stays cheap even for large stores.
  const protectedOrders = await db.protectedOrder.findMany({
    where: { shop: session.shop },
    select: {
      shopifyOrderId: true,
      protectionPriceCents: true,
      currency: true,
    },
  });
  const protectedById = new Map(
    protectedOrders.map((order) => [order.shopifyOrderId, order]),
  );
  const protectedIds = protectedOrders.map((order) => order.shopifyOrderId);

  const filterWhere =
    filter === "protected"
      ? { id: { in: protectedIds } }
      : filter === "unprotected"
        ? { id: { notIn: protectedIds } }
        : {};

  const [filteredCount, orders, totalCount, protectedCount, offers, settings] =
    await Promise.all([
      db.order.count({ where: { shop: session.shop, ...filterWhere } }),
      db.order.findMany({
        where: { shop: session.shop, ...filterWhere },
        // Newest orders first by when the customer placed them. createdAt is
        // only the cache-write time — a backfill stamps every row "now" — so it
        // serves purely as a fallback for rows cached before placedAt existed.
        orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.order.count({ where: { shop: session.shop } }),
      db.order.count({
        where: { shop: session.shop, id: { in: protectedIds } },
      }),
      db.protectionOffer.findMany({
        where: { shop: session.shop },
        orderBy: { createdAt: "desc" },
      }),
      db.merchantSettings.findUnique({ where: { shop: session.shop } }),
    ]);
  const currency = settings?.currency ?? "USD";
  const latestOffers = new Map<string, (typeof offers)[number]>();
  for (const offer of offers) {
    if (!latestOffers.has(offer.originalOrderId))
      latestOffers.set(offer.originalOrderId, offer);
  }
  const rows = orders.map((order) => {
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
  });

  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const workspaceCounts = await getWorkspaceCounts(session.shop);

  return {
    rows,
    filter,
    currency,
    workspaceCounts,
    page,
    pageSize,
    totalPages,
    filteredCount,
    counts: {
      all: totalCount,
      protected: protectedCount,
      unprotected: totalCount - protectedCount,
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

  // Per-shop throttle. send_offer is the tightest since each call emails a
  // customer; fulfill/deliver fan out to the Shopify API.
  const [maxRequests, windowMs] =
    intent === "send_offer" ? [30, 10 * 60 * 1000] : [60, 60 * 1000];
  if (
    await isRateLimited(
      `orders:${intent}:${session.shop}`,
      maxRequests,
      windowMs,
    )
  ) {
    return {
      ok: false,
      error: "Too many requests. Please wait a moment and try again.",
    };
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
  return (
    normalized.includes("fulfilled") && !normalized.includes("unfulfilled")
  );
}

function fulfillmentLabel(status: string): string {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function protectionLabel(offerStatus: string | null): string {
  if (offerStatus === "awaiting_payment") return "Awaiting payment";
  if (offerStatus === "offer_sent") return "Offer sent";
  return "Unprotected";
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
  const {
    rows,
    filter,
    counts,
    currency,
    workspaceCounts,
    page,
    pageSize,
    totalPages,
    filteredCount,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const offerFetcher = useFetcher<typeof action>();
  const [fulfillmentOrder, setFulfillmentOrder] = useState<{
    id: string;
    name: string;
  } | null>(null);
  useFetcherToast(
    offerFetcher,
    (data) => data.message ?? data.error ?? "Offer updated.",
  );

  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (pageSize !== DEFAULT_PAGE_SIZE)
      params.set("pageSize", String(pageSize));
    if (targetPage > 1) params.set("page", String(targetPage));
    const query = params.toString();
    return query ? `/app/orders?${query}` : "/app/orders";
  };

  const handlePageSizeChange = (nextPageSize: string) => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (Number(nextPageSize) !== DEFAULT_PAGE_SIZE) {
      params.set("pageSize", nextPageSize);
    }
    const query = params.toString();
    navigate(query ? `/app/orders?${query}` : "/app/orders");
  };

  return (
    <s-page heading="Orders">
      <s-paragraph color="subdued">
        See which Shopify orders include Kourify protection and which remain
        unprotected.
      </s-paragraph>
      <WorkspaceTabs
        active="orders"
        counts={{
          orders: workspaceCounts.ordersNeedingAction,
          claims: workspaceCounts.openClaims,
        }}
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
          label="Unprotected"
          tone={counts.unprotected ? "warning" : "default"}
          value={String(counts.unprotected)}
        />
      </div>

      <Card heading="Shopify orders">
        <div className="app-segmented-row">
          <div className="app-segmented">
            <div className="app-segmented__group">
              {FILTERS.map((value) => (
                <AppButton
                  key={value}
                  variant={filter === value ? "primary" : "secondary"}
                  href={
                    value === "all"
                      ? "/app/orders"
                      : `/app/orders?filter=${value}`
                  }
                >
                  {value === "all"
                    ? "All"
                    : value === "protected"
                      ? "Protected"
                      : "Unprotected"}
                </AppButton>
              ))}
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="order"
            heading="No orders here"
            description="Synchronize orders or choose another protection filter."
          />
        ) : (
          <>
            <div className="app-result-count">
              <s-text color="subdued">
                {`Showing ${(page - 1) * pageSize + 1}–${
                  (page - 1) * pageSize + rows.length
                } of ${filteredCount} order${filteredCount === 1 ? "" : "s"}`}
              </s-text>
            </div>
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
                      <s-table-cell>
                        <s-text type="strong">{order.name}</s-text>
                      </s-table-cell>
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
                        <span className="app-num">
                          {formatMoney(order.totalPrice, currency)}
                        </span>
                      </s-table-cell>
                      <s-table-cell>
                        {/* One badge per cell — "Delivered" supersedes
                          "Fulfilled", so rows keep a uniform height. */}
                        <s-badge
                          tone={
                            order.deliveredAt
                              ? "success"
                              : isFulfilled
                                ? "info"
                                : "neutral"
                          }
                        >
                          {order.deliveredAt
                            ? "Delivered"
                            : fulfillmentLabel(order.status)}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        {order.protected ? (
                          /* The fee itself carries the status — a protected
                           order is the only one with money in this column. */
                          <span className="app-protection-fee">
                            {order.protectionPriceCents
                              ? formatMoney(
                                  order.protectionPriceCents / 100,
                                  order.protectionCurrency,
                                )
                              : "Covered by you"}
                          </span>
                        ) : (
                          <s-stack direction="block" gap="small-100">
                            <span className="app-protection-state">
                              {protectionLabel(order.offerStatus)}
                            </span>
                            {order.offerStatus === "offer_sent" &&
                            order.offerExpiresAt ? (
                              <s-text color="subdued">
                                {offerExpiryLabel(order.offerExpiresAt)}
                              </s-text>
                            ) : null}
                          </s-stack>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <div className="app-row-actions">
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
                        </div>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </>
        )}

        {rows.length > 0 && (
          <s-stack
            direction="inline"
            gap="small-200"
            alignItems="center"
            justifyContent="space-between"
            paddingBlockStart="base"
          >
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">Show</s-text>
              <div style={{ inlineSize: "90px", flex: "0 0 auto" }}>
                <s-select
                  label="Rows per page"
                  labelAccessibilityVisibility="exclusive"
                  value={String(pageSize)}
                  onChange={(e) =>
                    handlePageSizeChange(
                      e.currentTarget.value ?? String(DEFAULT_PAGE_SIZE),
                    )
                  }
                >
                  {PAGE_SIZES.map((size) => (
                    <s-option key={size} value={String(size)}>
                      {size}
                    </s-option>
                  ))}
                </s-select>
              </div>
              <s-text color="subdued">orders per page</s-text>
            </s-stack>

            {totalPages > 1 && (
              <s-stack direction="inline" gap="small-200">
                <AppButton
                  variant="secondary"
                  disabled={page <= 1}
                  href={page > 1 ? pageHref(page - 1) : undefined}
                >
                  Previous
                </AppButton>
                <AppButton
                  variant="secondary"
                  disabled={page >= totalPages}
                  href={page < totalPages ? pageHref(page + 1) : undefined}
                >
                  Next
                </AppButton>
              </s-stack>
            )}
          </s-stack>
        )}
      </Card>
      {fulfillmentOrder ? (
        <Card heading={`Fulfill ${fulfillmentOrder.name}`}>
          <offerFetcher.Form method="post">
            <input type="hidden" name="intent" value="fulfill" />
            <input type="hidden" name="orderId" value={fulfillmentOrder.id} />
            <input type="hidden" name="confirmed" value="true" />
            <s-stack gap="base">
              <div style={{ maxInlineSize: "360px" }}>
                <s-text-field label="Tracking number" name="trackingNumber" />
              </div>
              <div style={{ maxInlineSize: "360px" }}>
                <s-text-field label="Shipping carrier" name="trackingCompany" />
              </div>
              <div style={{ maxInlineSize: "420px" }}>
                <s-text-field label="Tracking URL" name="trackingUrl" />
              </div>
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
