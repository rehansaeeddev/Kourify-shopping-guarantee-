import { createHash, randomBytes } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useFetcher, useLoaderData, useNavigate } from "react-router";

import { AppButton } from "../components/AppButton";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import db from "../db.server";
import { sendProtectionOffer } from "../lib/notify.server";
import { isRateLimited } from "../lib/rate-limit.server";
import { authenticate } from "../shopify.server";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import { getWorkspaceCounts } from "../lib/workspace-counts.server";
import { useFetcherToast } from "../hooks/useFetcherToast";

const FILTERS = ["all", "protected", "unprotected"] as const;
const FULFILLMENTS = ["all", "fulfilled", "unfulfilled"] as const;
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

  // Free-text search over the fields we cache. Capped and only ever used in
  // parameterized `contains` filters (never string-interpolated), so it can't
  // inject.
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const requestedFulfillment = url.searchParams.get("fulfillment");
  const fulfillment: (typeof FULFILLMENTS)[number] = FULFILLMENTS.includes(
    requestedFulfillment as (typeof FULFILLMENTS)[number],
  )
    ? (requestedFulfillment as (typeof FULFILLMENTS)[number])
    : "all";

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

  const searchWhere = q
    ? {
        OR: [
          { name: { contains: q } },
          { customerName: { contains: q } },
          { email: { contains: q } },
        ],
      }
    : {};
  // status stores Shopify's displayFulfillmentStatus lowercased, so "fulfilled"
  // is exact and everything else (unfulfilled, partially_fulfilled, pending) is
  // "not fulfilled".
  const fulfillmentWhere =
    fulfillment === "fulfilled"
      ? { status: "fulfilled" }
      : fulfillment === "unfulfilled"
        ? { status: { not: "fulfilled" } }
        : {};

  const listWhere = {
    shop: session.shop,
    ...filterWhere,
    ...searchWhere,
    ...fulfillmentWhere,
  };

  const [filteredCount, orders, totalCount, protectedCount, offers, settings] =
    await Promise.all([
      db.order.count({ where: listWhere }),
      db.order.findMany({
        where: listWhere,
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
    q,
    fulfillment,
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

type OrderRecord = NonNullable<Awaited<ReturnType<typeof db.order.findFirst>>>;
type SettingsRecord = NonNullable<
  Awaited<ReturnType<typeof db.merchantSettings.findUnique>>
>;

/**
 * Create a protection offer for one order and email the customer. Shared by the
 * single-row "Send offer" action and the bulk send. An eligibility problem
 * (no email, already fulfilled, already protected) comes back as a plain
 * failure; a failed email is flagged `failed` so the bulk summary can tell
 * "not eligible" apart from "couldn't send".
 */
async function createAndSendOffer(
  order: OrderRecord,
  settings: SettingsRecord,
  shop: string,
): Promise<{ ok: true } | { ok: false; error: string; failed?: boolean }> {
  if (!order.email)
    return { ok: false, error: "This order has no customer email." };
  if (isOrderFulfilled(order.status))
    return {
      ok: false,
      error: "Protection offers are only available before fulfillment.",
    };
  const alreadyProtected = await db.protectedOrder.findUnique({
    where: { shop_shopifyOrderId: { shop, shopifyOrderId: order.id } },
  });
  if (alreadyProtected)
    return { ok: false, error: "This order is already protected." };

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
      shop,
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
      offerUrl: `https://${shop}/apps/kourify/offer?token=${encodeURIComponent(rawToken)}`,
    });
  } catch (error) {
    await db.protectionOffer.delete({ where: { id: offer.id } });
    return {
      ok: false,
      failed: true,
      error:
        error instanceof Error
          ? error.message
          : "The offer email could not be sent.",
    };
  }

  return { ok: true };
}

const handleAction = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (
    !["send_offer", "bulk_send_offer", "fulfill", "deliver"].includes(intent)
  ) {
    return { ok: false, error: "Unknown action." };
  }

  // Per-shop throttle. The offer intents are the tightest since each one emails
  // customers; fulfill/deliver fan out to the Shopify API. A bulk send is one
  // request, so it shares the offer bucket and is capped by size below.
  const [maxRequests, windowMs] =
    intent === "send_offer" || intent === "bulk_send_offer"
      ? [30, 10 * 60 * 1000]
      : [60, 60 * 1000];
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

  if (intent === "bulk_send_offer") {
    const orderIds = String(formData.get("orderIds") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (!orderIds.length)
      return { ok: false, error: "Select at least one order first." };
    // Cap the batch: each id emails a customer, and one request shouldn't fan
    // out unbounded past the per-shop throttle.
    if (orderIds.length > 25)
      return {
        ok: false,
        error: "Send offers to at most 25 orders at a time.",
      };
    const settings = await db.merchantSettings.findUnique({
      where: { shop: session.shop },
    });
    if (!settings?.protectionEnabled || !settings.protectionVariantId) {
      return {
        ok: false,
        error:
          "Enable protection and create its product before sending offers.",
      };
    }
    const orders = await db.order.findMany({
      where: { id: { in: orderIds }, shop: session.shop },
    });
    // Skip orders that already carry a live offer, so a bulk send never
    // double-emails a customer who was already offered protection.
    const liveOffers = await db.protectionOffer.findMany({
      where: {
        shop: session.shop,
        originalOrderId: { in: orderIds },
        status: { in: ["offer_sent", "awaiting_payment"] },
      },
      select: { originalOrderId: true },
    });
    const alreadyOffered = new Set(
      liveOffers.map((offer) => offer.originalOrderId),
    );
    let sent = 0;
    let skipped = orderIds.length - orders.length; // ids that no longer exist
    let failed = 0;
    for (const order of orders) {
      if (alreadyOffered.has(order.id)) {
        skipped += 1;
        continue;
      }
      const result = await createAndSendOffer(order, settings, session.shop);
      if (result.ok) sent += 1;
      else if (result.failed) failed += 1;
      else skipped += 1;
    }
    const parts = [`Sent ${sent} offer${sent === 1 ? "" : "s"}`];
    if (skipped) parts.push(`skipped ${skipped}`);
    if (failed) parts.push(`${failed} failed to send`);
    return { ok: sent > 0, message: parts.join(" · ") };
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

  const settings = await db.merchantSettings.findUnique({
    where: { shop: session.shop },
  });
  if (!settings?.protectionEnabled || !settings.protectionVariantId) {
    return {
      ok: false,
      error: "Enable protection and create its product before sending offers.",
    };
  }
  const result = await createAndSendOffer(order, settings, session.shop);
  if (!result.ok) return { ok: false, error: result.error };
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
    q,
    fulfillment,
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

  // Marking an order delivered is irreversible (it stamps the delivery date and
  // opens post-delivery claim windows), so it's confirmed in a native modal
  // rather than a browser confirm() popup that ignores the admin theme.
  const deliverModalRef = useRef<{
    showOverlay: () => void;
    hideOverlay: () => void;
  } | null>(null);
  const [pendingDeliver, setPendingDeliver] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const confirmDeliver = () => {
    if (pendingDeliver) {
      offerFetcher.submit(
        { intent: "deliver", orderId: pendingDeliver.id, confirmed: "true" },
        { method: "POST" },
      );
    }
    setPendingDeliver(null);
    deliverModalRef.current?.hideOverlay();
  };

  const cancelDeliver = () => {
    setPendingDeliver(null);
    deliverModalRef.current?.hideOverlay();
  };

  // Bulk selection is scoped to the orders visible on this page; navigating to
  // another page or filter clears it so a hidden row can never be acted on.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter, fulfillment, q, page, pageSize]);

  const pageOrderIds = rows.map((order) => order.id);
  const allSelected =
    pageOrderIds.length > 0 && pageOrderIds.every((id) => selectedIds.has(id));

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelectedIds((prev) =>
      pageOrderIds.every((id) => prev.has(id))
        ? new Set()
        : new Set(pageOrderIds),
    );

  const submitBulkOffer = () => {
    offerFetcher.submit(
      {
        intent: "bulk_send_offer",
        orderIds: Array.from(selectedIds).join(","),
      },
      { method: "POST" },
    );
    setSelectedIds(new Set());
  };

  // Build an /app/orders URL from the current filter/search state, overriding
  // only what changed. Changing a filter, search or page keeps the rest intact.
  const ordersHref = (next: {
    filter?: string;
    fulfillment?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    const f = next.filter ?? filter;
    const ff = next.fulfillment ?? fulfillment;
    const query = next.q ?? q;
    const size = next.pageSize ?? pageSize;
    const targetPage = next.page ?? 1;
    if (f !== "all") params.set("filter", f);
    if (ff !== "all") params.set("fulfillment", ff);
    if (query) params.set("q", query);
    if (size !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(size));
    if (targetPage > 1) params.set("page", String(targetPage));
    const search = params.toString();
    return search ? `/app/orders?${search}` : "/app/orders";
  };

  const pageHref = (targetPage: number) => ordersHref({ page: targetPage });

  const handlePageSizeChange = (nextPageSize: string) => {
    navigate(ordersHref({ pageSize: Number(nextPageSize) }));
  };

  return (
    <s-page heading="Orders">
      <WorkspaceTabs
        active="orders"
        counts={{
          orders: workspaceCounts.ordersNeedingAction,
          claims: workspaceCounts.openClaims,
        }}
      />

      <Card heading="Shopify orders">
        <s-grid
          gridTemplateColumns="@container (inline-size <= 640px) 1fr, 1fr auto auto"
          gap="base"
          alignItems="end"
        >
          {/* Search submits on Enter; the two dropdowns navigate on change.
              filter + fulfillment ride along as hidden inputs so a search keeps
              the active filters. */}
          <Form method="get">
            {filter !== "all" ? (
              <input type="hidden" name="filter" value={filter} />
            ) : null}
            {fulfillment !== "all" ? (
              <input type="hidden" name="fulfillment" value={fulfillment} />
            ) : null}
            <s-search-field
              label="Search orders"
              labelAccessibilityVisibility="exclusive"
              name="q"
              value={q}
              placeholder="Search order #, customer, or email"
            />
          </Form>
          <s-box minInlineSize="170px">
            <s-select
              label="Protection"
              value={filter}
              onChange={(e) =>
                navigate(
                  ordersHref({ filter: e.currentTarget.value ?? "all", page: 1 }),
                )
              }
            >
              <s-option value="all">{`All (${counts.all})`}</s-option>
              <s-option value="protected">
                {`Protected (${counts.protected})`}
              </s-option>
              <s-option value="unprotected">
                {`Unprotected (${counts.unprotected})`}
              </s-option>
            </s-select>
          </s-box>
          <s-box minInlineSize="170px">
            <s-select
              label="Fulfillment"
              value={fulfillment}
              onChange={(e) =>
                navigate(
                  ordersHref({
                    fulfillment: e.currentTarget.value ?? "all",
                    page: 1,
                  }),
                )
              }
            >
              <s-option value="all">Any fulfillment</s-option>
              <s-option value="fulfilled">Fulfilled</s-option>
              <s-option value="unfulfilled">Unfulfilled</s-option>
            </s-select>
          </s-box>
        </s-grid>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon="order"
            heading={
              q || filter !== "all" || fulfillment !== "all"
                ? "No matching orders"
                : "No orders here"
            }
            description={
              q || filter !== "all" || fulfillment !== "all"
                ? "Nothing matches your search and filters. Try clearing them."
                : "Synchronize orders to see them here."
            }
          />
        ) : (
          <>
            {/* Fixed-height header bar: the min height is reserved, so the
                bulk actions can appear on the right only once rows are selected
                without ever changing the bar's height — nothing shifts, and no
                disabled button lingers on top while nothing is selected. */}
            <s-box minBlockSize="44px">
              <s-stack
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-stack
                  direction="inline"
                  gap="small-200"
                  alignItems="center"
                >
                  <s-checkbox
                    checked={allSelected}
                    accessibilityLabel="Select all orders on this page"
                    onChange={toggleAll}
                  />
                  {selectedIds.size > 0 ? (
                    <s-text type="strong">{`${selectedIds.size} selected`}</s-text>
                  ) : (
                    <s-text color="subdued">
                      {`Showing ${(page - 1) * pageSize + 1}–${
                        (page - 1) * pageSize + rows.length
                      } of ${filteredCount} order${filteredCount === 1 ? "" : "s"}`}
                    </s-text>
                  )}
                </s-stack>
                {selectedIds.size > 0 ? (
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <AppButton
                      variant="secondary"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Clear
                    </AppButton>
                    <AppButton
                      variant="primary"
                      loading={offerFetcher.state !== "idle"}
                      disabled={offerFetcher.state !== "idle"}
                      onClick={submitBulkOffer}
                    >
                      Send protection offer
                    </AppButton>
                  </s-stack>
                ) : null}
              </s-stack>
            </s-box>
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Order</s-table-header>
                <s-table-header listSlot="secondary">Customer</s-table-header>
                <s-table-header listSlot="labeled">Total</s-table-header>
                <s-table-header listSlot="labeled">Fulfillment</s-table-header>
                <s-table-header listSlot="labeled">Protection</s-table-header>
                <s-table-header listSlot="inline">Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((order) => {
                  const orderId = order.id.split("/").pop();
                  const isFulfilled = isOrderFulfilled(order.status);
                  return (
                    <s-table-row key={order.id}>
                      <s-table-cell>
                        <s-stack
                          direction="inline"
                          gap="small-200"
                          alignItems="center"
                        >
                          <s-checkbox
                            checked={selectedIds.has(order.id)}
                            accessibilityLabel={`Select ${order.name}`}
                            onChange={() => toggleOne(order.id)}
                          />
                          <s-text type="strong">{order.name}</s-text>
                        </s-stack>
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
                        <s-text fontVariantNumeric="tabular-nums">
                          {formatMoney(order.totalPrice, currency)}
                        </s-text>
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
                          <s-text
                            type="strong"
                            fontVariantNumeric="tabular-nums"
                          >
                            {order.protectionPriceCents
                              ? formatMoney(
                                  order.protectionPriceCents / 100,
                                  order.protectionCurrency,
                                )
                              : "Covered by you"}
                          </s-text>
                        ) : (
                          <s-stack direction="block" gap="small-100">
                            <s-text color="subdued">
                              {protectionLabel(order.offerStatus)}
                            </s-text>
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
                        <s-button
                          variant="tertiary"
                          icon="menu-horizontal"
                          accessibilityLabel={`Actions for ${order.name}`}
                          commandFor={`order-actions-${orderId}`}
                          command="--show"
                        ></s-button>
                        <s-menu
                          id={`order-actions-${orderId}`}
                          accessibilityLabel={`Actions for ${order.name}`}
                        >
                          <s-button
                            variant="tertiary"
                            href={`shopify://admin/orders/${orderId}`}
                          >
                            View order
                          </s-button>
                          {!order.protected &&
                          !isFulfilled &&
                          order.email &&
                          !["offer_sent", "awaiting_payment"].includes(
                            order.offerStatus ?? "",
                          ) ? (
                            <s-button
                              variant="tertiary"
                              onClick={() =>
                                offerFetcher.submit(
                                  { intent: "send_offer", orderId: order.id },
                                  { method: "POST" },
                                )
                              }
                            >
                              Send offer
                            </s-button>
                          ) : null}
                          {order.protected && !isFulfilled ? (
                            <s-button
                              variant="tertiary"
                              onClick={() => setFulfillmentOrder(order)}
                            >
                              Fulfill order
                            </s-button>
                          ) : null}
                          {order.protected &&
                          isFulfilled &&
                          !order.deliveredAt ? (
                            <s-button
                              variant="tertiary"
                              onClick={() => {
                                setPendingDeliver({
                                  id: order.id,
                                  name: order.name,
                                });
                                deliverModalRef.current?.showOverlay();
                              }}
                            >
                              Mark as delivered
                            </s-button>
                          ) : null}
                        </s-menu>
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
              <s-box inlineSize="90px">
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
              </s-box>
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
              <s-box maxInlineSize="360px">
                <s-text-field label="Tracking number" name="trackingNumber" />
              </s-box>
              <s-box maxInlineSize="360px">
                <s-text-field label="Shipping carrier" name="trackingCompany" />
              </s-box>
              <s-box maxInlineSize="420px">
                <s-text-field label="Tracking URL" name="trackingUrl" />
              </s-box>
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
                <AppButton
                  type="submit"
                  variant="primary"
                  loading={offerFetcher.state !== "idle"}
                  disabled={offerFetcher.state !== "idle"}
                >
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

      <s-modal
        ref={deliverModalRef as never}
        id="kourify-deliver-confirm-modal"
        heading="Mark as delivered"
      >
        <s-paragraph>
          {pendingDeliver
            ? `Confirm that ${pendingDeliver.name} was actually delivered. This records the delivery date and starts any post-delivery claim windows, and can't be undone.`
            : ""}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={offerFetcher.state !== "idle"}
          disabled={offerFetcher.state !== "idle"}
          onClick={confirmDeliver}
        >
          Mark as delivered
        </s-button>
        <s-button slot="secondary-actions" onClick={cancelDeliver}>
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
