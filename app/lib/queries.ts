import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { api } from "./api";

/**
 * Every call this admin makes, in one place.
 *
 * Keys are arrays so a mutation can invalidate a whole page's worth of data
 * with one prefix — changing a claim touches the dashboard's counts too, and
 * leaving those stale is how a merchant sees a badge that no longer matches
 * the list beneath it.
 */
export const keys = {
  dashboard: ["dashboard"] as const,
  dashboardTrends: ["dashboard", "trends"] as const,
  claims: (params: Record<string, unknown> = {}) => ["claims", params] as const,
  orders: (params: Record<string, unknown> = {}) => ["orders", params] as const,
  settings: ["settings"] as const,
  claimPreview: ["claim-preview"] as const,
  translations: ["translations"] as const,
  orderSync: (page: number) => ["order-sync", page] as const,
  billing: ["billing"] as const,
};

function search(params: Record<string, unknown>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    // Absent and empty are the same thing to every endpoint here, and leaving
    // them out keeps the cache key and the URL in step.
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }

  const stringified = query.toString();

  return stringified ? `?${stringified}` : "";
}

// ---------------------------------------------------------------- reading

export const useDashboard = () =>
  useQuery({
    queryKey: keys.dashboard,
    queryFn: () => api.get<Dashboard>("/dashboard"),
  });

export const useDashboardTrends = () =>
  useQuery({
    queryKey: keys.dashboardTrends,
    queryFn: () => api.get<Trends>("/dashboard/trends"),
  });

export const useClaims = (params: ClaimsParams) =>
  useQuery({
    queryKey: keys.claims(params),
    queryFn: () => api.get<ClaimsPage>(`/claims${search(params)}`),
    // Paging through a list should not blank the table between pages.
    placeholderData: (previous) => previous,
  });

export const useOrders = (params: OrdersParams) =>
  useQuery({
    queryKey: keys.orders(params),
    queryFn: () => api.get<OrdersPage>(`/orders${search(params)}`),
    placeholderData: (previous) => previous,
  });

export const useSettings = () =>
  useQuery({
    queryKey: keys.settings,
    queryFn: () => api.get<SettingsPayload>("/settings"),
  });

/**
 * The storefront claim page itself, for the branding panel to frame.
 *
 * The real page from the same view the storefront serves, not a sketch of it
 * in admin markup -- so it cannot drift, and the merchant's colours reach it
 * through Branding::cssVariables() rather than being painted here.
 */
export const useClaimPreview = () =>
  useQuery({
    queryKey: keys.claimPreview,
    queryFn: () => api.get<{ html: string }>("/settings/claim-preview"),
    // A saved colour is only worth seeing once the page has been rebuilt
    // with it, so this always refetches rather than serving a stale frame.
    staleTime: 0,
  });

export const useTranslations = () =>
  useQuery({
    queryKey: keys.translations,
    queryFn: () => api.get<TranslationsPayload>("/translations"),
  });

export const useOrderSync = (page: number) =>
  useQuery({
    queryKey: keys.orderSync(page),
    queryFn: () => api.get<OrderSyncPayload>(`/order-sync${search({ page })}`),
    /*
     * A running backfill is the only thing here that changes without the
     * merchant doing something, so this is the one query that polls — and
     * only while a job is actually in flight.
     */
    refetchInterval: (query) =>
      (query.state.data?.activeJobCount ?? 0) > 0 ? 5_000 : false,
  });

export const useBilling = () =>
  useQuery({
    queryKey: keys.billing,
    queryFn: () => api.get<BillingPayload>("/billing"),
  });

// --------------------------------------------------------------- writing

/**
 * Wraps a mutation so it refreshes what it affected.
 *
 * Passing the keys explicitly beats invalidating everything: a claim decision
 * should refresh the claims list and the dashboard counts, not refetch the
 * settings page a merchant is not looking at.
 */
function useInvalidating<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  invalidates: readonly (readonly unknown[])[],
  options?: Omit<UseMutationOptions<TData, Error, TVariables>, "mutationFn">,
) {
  const client = useQueryClient();

  return useMutation({
    mutationFn,
    ...options,
    onSuccess: (...args) => {
      for (const key of invalidates) {
        void client.invalidateQueries({ queryKey: key });
      }

      options?.onSuccess?.(...args);
    },
  });
}

export const useUpdateClaim = () =>
  useInvalidating(
    ({ id, ...body }: UpdateClaim) =>
      api.patch<{ ok: boolean }>(`/claims/${id}`, body),
    [["claims"], keys.dashboard],
  );

export const useBulkUpdateClaims = () =>
  useInvalidating(
    (body: BulkUpdateClaims) => api.post<BulkResult>("/claims/bulk", body),
    [["claims"], keys.dashboard],
  );

export const useSaveBadges = () =>
  useInvalidating(
    (body: Record<string, unknown>) =>
      api.put<SaveResult>("/settings/badges", body),
    [keys.settings],
  );

export const useSaveBranding = () =>
  useInvalidating(
    (body: Record<string, unknown>) =>
      api.put<SaveResult>("/settings/branding", body),
    [keys.settings, keys.claimPreview],
  );

/**
 * The logo, as a data URL. Sent on its own so a five-megabyte image and a
 * three-field form do not fail together — and so a slow upload does not hold
 * up a colour change.
 */
export const useSaveBrandLogo = () =>
  useInvalidating(
    (logo: string) => api.put<SaveResult>("/settings/branding/logo", { logo }),
    [keys.settings, keys.claimPreview],
  );

/**
 * The merchant's own blocks, written into the default language.
 *
 * Its own endpoint rather than a four-key call to the translations PUT: that
 * one replaces a language's whole string set by design, so a partial payload
 * would delete every other translation the shop had written.
 */
export const useSaveClaimText = () =>
  useInvalidating(
    (text: Record<string, string>) =>
      api.put<Ok>("/settings/branding/text", { text }),
    [keys.settings, keys.translations, keys.claimPreview],
  );

export const useSaveProtection = () =>
  useInvalidating(
    (body: Record<string, unknown>) =>
      api.put<SaveResult>("/settings/protection", body),
    // Protection touches the allowance and the plan mirror, both of which the
    // dashboard and billing pages show.
    [keys.settings, keys.dashboard, keys.billing],
  );

/*
 * Every order action changes what the orders list and the dashboard show —
 * an offer sent, an order fulfilled, a delivery recorded — so all four
 * refresh the same pair.
 */
const ORDER_KEYS = [["orders"], keys.dashboard] as const;

export const useSendOffer = () =>
  useInvalidating(
    (body: { orderId: string }) => api.post<Ok>("/orders/offer", body),
    ORDER_KEYS,
  );

export const useSendOffers = () =>
  useInvalidating(
    (body: { orderIds: string[] }) =>
      api.post<BulkOfferResult>("/orders/offers", body),
    ORDER_KEYS,
  );

export const useFulfillOrder = () =>
  useInvalidating(
    (body: FulfillOrder) => api.post<Ok>("/orders/fulfill", body),
    ORDER_KEYS,
  );

export const useDeliverOrder = () =>
  useInvalidating(
    (body: { orderId: string; confirmed: true }) =>
      api.post<Ok>("/orders/deliver", body),
    ORDER_KEYS,
  );

export const useStartOrderSync = () =>
  useInvalidating(() => api.post<SyncResult>("/order-sync"), [["order-sync"]]);

export const useSubscribe = () =>
  useInvalidating(
    (body: { plan: string }) =>
      api.post<SubscribeResult>("/billing/subscribe", body),
    [keys.billing, keys.dashboard, keys.settings],
  );

export const useTranslationMutations = () => ({
  add: useInvalidating(
    (body: { locale: string; label?: string }) =>
      api.post<Ok>("/translations", body),
    [keys.translations],
  ),
  seed: useInvalidating(
    () => api.post<Ok>("/translations/seed"),
    [keys.translations],
  ),
  saveStrings: useInvalidating(
    ({
      locale,
      strings,
    }: {
      locale: string;
      strings: Record<string, string>;
    }) => api.put<Ok>(`/translations/${locale}/strings`, { strings }),
    [keys.translations],
  ),
  update: useInvalidating(
    ({ locale, ...body }: { locale: string } & Record<string, unknown>) =>
      api.patch<Ok>(`/translations/${locale}`, body),
    [keys.translations],
  ),
  remove: useInvalidating(
    (locale: string) => api.delete<Ok>(`/translations/${locale}`),
    [keys.translations],
  ),
  setDefault: useInvalidating(
    (locale: string) => api.put<Ok>("/translations/default", { locale }),
    [keys.translations],
  ),
});

// ----------------------------------------------------------------- shapes

/**
 * The MerchantSettings row exactly as the backend serialises it.
 *
 * claimWindows stays a JSON string here — it lives in a text column, and the
 * settings payload hands back its own decoded copy alongside the row rather
 * than parsing it at every call site.
 */
export type MerchantSettings = {
  id: string;
  shop: string;
  badgesEnabled: boolean;
  badgeStyle: string;
  showOnProduct: boolean;
  showOnCart: boolean;
  guaranteeTabPosition: string;
  protectionPayer: string;
  enabledClaimTypes: string;
  claimWindows: string;
  protectionFeeType: string;
  protectionFlatFeeCents: number;
  protectionPercentBasisPoints: number;
  protectionMinFeeCents: number;
  protectionMaxFeeCents: number;
  /** null means no ceiling was set, which is not the same as zero. */
  maxEligibleItemValueCents: number | null;
  protectionEnabled: boolean;
  /**
   * What the merchant chose for the storefront claim page. Null on all four
   * means they have chosen nothing, and the page keeps its own design --
   * which is not the same as having chosen its colours.
   */
  brandName: string | null;
  brandLogoUrl: string | null;
  brandColor: string | null;
  brandSurface: string | null;
  /** Where the introduction sits, and whether the promises show with it. */
  claimStoryPosition: string;
  claimShowPromises: boolean;
  /** Where the logo and shop name sit, which is its own choice. */
  claimBrandPosition: string;
  plan: string;
  currency: string;
  storefrontFallbackLanguage: string;
  storefrontLanguages: string;
  protectionProductId: string | null;
  protectionVariantId: string | null;
  planTier: string;
  cartTransformId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Quota = {
  limit: number | null;
  used: number;
  remaining: number | null;
  exhausted: boolean;
  overAllowance: boolean;
};

export type Claim = {
  id: string;
  orderNumber: string;
  shopifyOrderName: string | null;
  shopifyOrderId: string | null;
  fullName: string;
  email: string;
  issueType: string;
  status: string;
  orderRiskLevel: string | null;
  evidenceUrl: string | null;
  details: string | null;
  decisionNote: string | null;
  claimedQuantity: number | null;
  itemValueCents: number | null;
  eligibleLossCents: number | null;
  settlementCents: number | null;
  createdAt: string;
  resolvedAt: string | null;
  protectedItem: { id: string; title: string; sku: string | null } | null;
};

export type WorkspaceCounts = {
  openClaims: number;
  ordersNeedingAction: number;
};

export type Dashboard = {
  shop: string;
  settings: MerchantSettings;
  openClaims: number;
  ordersNeedingAction: number;
  totalClaims: number;
  recentClaims: Claim[];
  telemetry: { avgResolutionHours: number | null; incidentRate: number | null };
  analytics: {
    protectedOrders: number;
    totalOrders: number;
    conversionRate: number;
    protectionRevenueCents: number;
    usageFeesCents: number;
  };
  hasActiveBilling: boolean;
  activePlan: string;
  quota: Quota;
};

export type Trends = {
  claims: { dailyCounts: number[]; last7Count: number; previous7Count: number };
  resolved: number[];
};

export type ClaimsParams = { tab?: string; q?: string; page?: number };

export type ClaimsPage = {
  claims: Claim[];
  tab: string;
  q: string;
  page: number;
  /** The backend's own page size, so the range label is never a guess. */
  pageSize: number;
  filteredCount: number;
  totalPages: number;
  totalClaims: number;
  openClaims: number;
  resolvedClaims: number;
  resolvedTrend: number[];
  workspaceCounts: WorkspaceCounts;
  emailClaimNumbers: Record<string, number>;
};

export type OrdersParams = {
  filter?: string;
  fulfillment?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type OrderRow = {
  id: string;
  name: string;
  email: string;
  customerName: string | null;
  status: string;
  riskLevel: string | null;
  shippedAt: string | null;
  placedAt: string | null;
  totalPrice: string | null;
  protected: boolean;
  protectionPriceCents: number | null;
  protectionCurrency: string;
  deliveredAt: string | null;
  offerStatus: string | null;
  offerExpiresAt: string | null;
};

export type OrdersPage = {
  rows: OrderRow[];
  filter: string;
  fulfillment: string;
  q: string;
  page: number;
  pageSize: number;
  filteredCount: number;
  totalPages: number;
  currency: string;
  workspaceCounts: WorkspaceCounts;
  counts: { all: number; protected: number; unprotected: number };
};

export type SettingsPayload = {
  settings: MerchantSettings;
  claimWindows: Record<string, { minDays: number; maxDays: number }>;
  enabledClaimTypes: string[];
  issueTypes: { value: string; label: string }[];
  planTier: string;
  activePlan: string;
  hasActiveBilling: boolean;
  quota: Quota;
  customerPaysAllowed: boolean;
  /**
   * The merchant's own blocks on the claim page, as saved in the default
   * language. Keyed by the translation key, dots and all -- they live in a
   * translation row rather than a settings column so they can be translated
   * like every other word on that page.
   */
  claimText: Record<string, string>;
};

export type Language = {
  id: string;
  locale: string;
  label: string;
  direction: string;
  enabled: boolean;
  strings: Record<string, string>;
  translatedCount: number;
};

export type TranslationsPayload = {
  languages: Language[];
  keys: string[];
  /**
   * Keys a shop is not expected to fill in -- the merchant's own blocks,
   * which ship empty by design. Left in the denominator, no shop would ever
   * read as fully translated.
   */
  optionalKeys: string[];
  suggestedLabels: Record<string, string>;
  defaultLocale: string;
  /**
   * What the shop's own storefront publishes, so the screen can offer those
   * instead of asking for a locale code. Empty when Shopify could not be
   * reached -- not an error, just a reason to show the manual field.
   */
  shopLanguages: ShopLanguage[];
};

export type ShopLanguage = {
  locale: string;
  label: string;
  primary: boolean;
};

export type SyncJob = {
  id: string;
  status: string;
  objectCount: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type OrderSyncPayload = {
  enabled: boolean;
  orderCount: number;
  lastSyncedAt: string | null;
  jobs: SyncJob[];
  page: number;
  totalPages: number;
  /** Every job, not just this page's — the jobs card counts the lot. */
  jobCount: number;
  activeJobCount: number;
  workspaceCounts: WorkspaceCounts;
};

export type BillingPayload = {
  activePlan: string;
  hasActiveBilling: boolean;
  quota: Quota;
  protectedOrders: number;
  billedUsageCents: number;
  testMode: boolean;
};

type Ok = { ok: boolean; message?: string; error?: string | null };
type SaveResult = Ok & { settings: MerchantSettings };
type BulkResult = Ok & { changed: number; skipped: number };
type SyncResult = Ok & { error?: string };
type SubscribeResult = {
  ok: boolean;
  confirmationUrl?: string;
  error?: string;
};
type BulkOfferResult = Ok & { sent: number; skipped: number; failed: number };

export type FulfillOrder = {
  orderId: string;
  confirmed: true;
  trackingNumber?: string;
  trackingCompany?: string;
  trackingUrl?: string;
  notifyCustomer?: boolean;
};

export type UpdateClaim = {
  id: string;
  status: string;
  settlementCents?: number | string;
  decisionNote?: string;
};

export type BulkUpdateClaims = { status: string; claimIds: string[] };
