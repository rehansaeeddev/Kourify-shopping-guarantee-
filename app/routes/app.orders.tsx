import { useEffect, useRef, useState } from "react";
import { Form, useNavigate, useSearchParams } from "react-router";

import { AppButton } from "../components/AppButton";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageError, PageSkeleton } from "../components/PageState";
import { useToast } from "../components/Toast";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import {
  useDeliverOrder,
  useFulfillOrder,
  useOrders,
  useSendOffer,
  useSendOffers,
} from "../lib/queries";

const FILTERS = ["all", "protected", "unprotected"] as const;
const FULFILLMENTS = ["all", "fulfilled", "unfulfilled"] as const;
const PAGE_SIZES = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

/**
 * The first allowed value, or the first entry as the default.
 *
 * Used on every query parameter this page reads, so a hand-edited URL can
 * never reach the query key — the list would be cached under a filter the
 * backend does not apply.
 */
function pick<T extends readonly (string | number)[]>(
  allowed: T,
  value: string | number | null,
): T[number] {
  return allowed.includes(value as T[number])
    ? (value as T[number])
    : allowed[0];
}

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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();

  /*
   * The URL is the source of truth for what is listed, and it is normalised
   * here rather than trusted: an arbitrary ?filter=whatever would otherwise
   * become its own cache entry for a list the backend serves unfiltered.
   */
  const params = {
    filter: pick(FILTERS, searchParams.get("filter")),
    fulfillment: pick(FULFILLMENTS, searchParams.get("fulfillment")),
    q: searchParams.get("q") ?? "",
    page: Math.max(1, Math.floor(Number(searchParams.get("page")) || 1)),
    pageSize: pick(PAGE_SIZES, Number(searchParams.get("pageSize"))),
  };

  const { data, isPending, error, refetch } = useOrders(params);

  const sendOffer = useSendOffer();
  const sendOffers = useSendOffers();
  const fulfillOrder = useFulfillOrder();
  const deliverOrder = useDeliverOrder();

  const [fulfillmentOrder, setFulfillmentOrder] = useState<{
    id: string;
    name: string;
  } | null>(null);

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
      deliverOrder.mutate(
        { orderId: pendingDeliver.id, confirmed: true },
        notify,
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
  }, [
    params.filter,
    params.fulfillment,
    params.q,
    params.page,
    params.pageSize,
  ]);

  /*
   * Every action here either emails a shopper or calls Shopify, and both
   * report in the backend's own words — "Sent 3 offers · skipped 1" carries
   * more than any sentence this page could compose from a status code.
   */
  const notify = {
    onSuccess: (result: { message?: string }) =>
      showToast(result.message ?? "Order updated."),
    onError: (cause: Error) => showToast(cause.message, { isError: true }),
  };

  const busy =
    sendOffer.isPending ||
    sendOffers.isPending ||
    fulfillOrder.isPending ||
    deliverOrder.isPending;

  if (isPending) return <PageSkeleton heading="Orders" />;
  if (error)
    return <PageError heading="Orders" error={error} onRetry={refetch} />;

  const { rows, counts, currency, workspaceCounts, totalPages, filteredCount } =
    data;
  const { filter, fulfillment, q, page, pageSize } = params;

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
    sendOffers.mutate({ orderIds: Array.from(selectedIds) }, notify);
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
                  ordersHref({
                    filter: e.currentTarget.value ?? "all",
                    page: 1,
                  }),
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
                <s-stack direction="inline" gap="small-200" alignItems="center">
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
                      loading={sendOffers.isPending}
                      disabled={busy}
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
                                sendOffer.mutate({ orderId: order.id }, notify)
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
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);

              fulfillOrder.mutate(
                {
                  orderId: fulfillmentOrder.id,
                  // The server asks for this too: fulfilling is not something
                  // to trigger from a stray request.
                  confirmed: true,
                  trackingNumber: String(form.get("trackingNumber") ?? ""),
                  trackingCompany: String(form.get("trackingCompany") ?? ""),
                  trackingUrl: String(form.get("trackingUrl") ?? ""),
                  notifyCustomer: form.get("notifyCustomer") === "true",
                },
                {
                  ...notify,
                  onSuccess: (result) => {
                    notify.onSuccess(result);
                    setFulfillmentOrder(null);
                  },
                },
              );
            }}
          >
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
                  loading={fulfillOrder.isPending}
                  disabled={busy}
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
          </form>
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
          loading={deliverOrder.isPending}
          disabled={busy}
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
