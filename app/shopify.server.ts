import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

export const USAGE_PLAN = "Kourify Usage";
export const UNLIMITED_PLAN = "Kourify Unlimited";
export const UNLIMITED_ANNUAL_PLAN = "Kourify Unlimited Annual";

/**
 * Basic is free, so it has no entry here on purpose: a shop with no active
 * paid subscription *is* on Basic. Shopify's billing API is for charges, and
 * creating a $0 subscription just to represent "free" would add an approval
 * step for a plan that costs nothing.
 */

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  webhooks: {
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/create",
    },
    ORDERS_UPDATED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/updated",
    },
    ORDERS_PAID: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/paid",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      // shopify.app.toml declares these as config-based webhooks too, but that
      // registration path wasn't reliably firing during `shopify app dev`
      // (confirmed via direct API checks — subscriptions stayed empty across
      // several dev sessions). Registering them here runs on every real
      // authenticated request instead, using whatever the app's current URL
      // actually is, so it self-heals after every tunnel/URL change.
      await shopify.registerWebhooks({ session });
    },
  },
  billing: {
    [USAGE_PLAN]: {
      lineItems: [
        {
          amount: 10,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
        {
          amount: 500,
          currencyCode: "USD",
          interval: BillingInterval.Usage,
          terms: "$0.60 per completed order containing Kourify protection",
        },
      ],
    },
    [UNLIMITED_PLAN]: {
      lineItems: [
        {
          amount: 20,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    // Annual is offered on Unlimited only. Shopify's usage line items are
    // valid with EVERY_30_DAYS but not ANNUAL, so an annual Usage plan
    // couldn't carry the per-order charge that defines it.
    [UNLIMITED_ANNUAL_PLAN]: {
      lineItems: [
        {
          amount: 200,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = {
  ...shopify.authenticate,
  admin: async (request: Request) => {
    try {
      return await shopify.authenticate.admin(request);
    } catch (error) {
      if (error instanceof Response) {
        console.error(
          `[authenticate.admin] ${request.method} ${request.url} -> ${error.status} ${error.statusText}`,
          await error
            .clone()
            .text()
            .catch(() => ""),
        );
      } else {
        console.error(
          `[authenticate.admin] ${request.method} ${request.url} threw`,
          error,
        );
      }
      throw error;
    }
  },
};
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
