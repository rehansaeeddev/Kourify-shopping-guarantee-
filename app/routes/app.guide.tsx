import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { PageHeader } from "../components/PageHeader";
import { Card } from "../components/Card";
import { AppButton } from "../components/AppButton";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Guide is informational, but still behind app auth like every other page.
  await authenticate.admin(request);
  return null;
};

const SECTIONS = [
  { id: "overview", label: "What Kourify does" },
  { id: "getting-started", label: "Getting started" },
  { id: "plans", label: "Plans & billing" },
  { id: "protection", label: "Protection settings" },
  { id: "badges", label: "Trust badges & widgets" },
  { id: "customer-claim", label: "How customers file a claim" },
  { id: "managing-claims", label: "Managing claims" },
  { id: "orders", label: "Orders & offers" },
  { id: "languages", label: "Languages" },
  { id: "order-sync", label: "Order sync" },
  { id: "faq", label: "Notes & FAQ" },
] as const;

export default function Guide() {
  return (
    <s-page>
      <PageHeader
        title="User guide"
        subtitle="Everything you need to set up and run Kourify Shopping Guarantee."
        actions={
          <AppButton href="/app" variant="secondary">
            Back to home
          </AppButton>
        }
      />

      <div className="app-guide">
        <Card heading="On this page">
          <ol className="app-guide-toc">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.label}</a>
              </li>
            ))}
          </ol>
        </Card>

        <div id="overview">
          <Card heading="What Kourify does">
            <s-paragraph>
              Kourify adds an optional package-protection guarantee to your
              store. Shoppers can cover their order against loss, damage, and
              theft, and file a claim from your storefront if something goes
              wrong. You review and resolve those claims from the admin.
            </s-paragraph>
            <p className="app-guide__sub">An order becomes protected two ways:</p>
            <ul className="app-guide__list">
              <li>
                <strong>Customer pays</strong> — the shopper adds protection at
                checkout and is charged your fee.
              </li>
              <li>
                <strong>You pay</strong> — you cover protection for every order,
                free to the customer.
              </li>
            </ul>
            <s-banner tone="info">
              Protection today is an honest, self-funded guarantee — not
              underwritten insurance. Claims are reviewed manually, not paid out
              automatically.
            </s-banner>
          </Card>
        </div>

        <div id="getting-started">
          <Card heading="Getting started">
            <ol className="app-guide__steps">
              <li>
                <strong>Choose a plan.</strong> Open{" "}
                <Link to="/app/protection">Protection</Link> and pick Usage or
                Unlimited. Protection can&apos;t be enabled without an active
                plan.
              </li>
              <li>
                <strong>Enable protection.</strong> Turn on the switch, then set
                who pays and your pricing.
              </li>
              <li>
                <strong>Add the storefront blocks.</strong> In your theme
                editor, add the Kourify trust badge and the &quot;Protect your
                order&quot; widget to your product and cart pages.
              </li>
              <li>
                <strong>Review your first claim.</strong> When a customer files
                one, it appears under <Link to="/app/claims">Claims</Link>.
              </li>
            </ol>
          </Card>
        </div>

        <div id="plans">
          <Card heading="Plans & billing">
            <ul className="app-guide__list">
              <li>
                <strong>Usage — $10/mo + $0.60 per protected order.</strong> Best
                when volume is low or seasonal.
              </li>
              <li>
                <strong>Unlimited — $20/mo.</strong> No per-order fee; best at
                higher volume.
              </li>
            </ul>
            <s-paragraph>
              Billing runs through Shopify — you approve the charge in Shopify&apos;s
              own screen, and you can switch or cancel anytime from the{" "}
              <Link to="/app/protection">Protection</Link> page. Kourify reads your
              live subscription from Shopify; it never trusts the browser for
              billing state.
            </s-paragraph>
          </Card>
        </div>

        <div id="protection">
          <Card heading="Protection settings">
            <p className="app-guide__sub">Enable protection</p>
            <s-paragraph>
              The master switch. Everything below only applies while protection
              is on and a plan is active.
            </s-paragraph>

            <p className="app-guide__sub">Who pays</p>
            <s-paragraph>
              Choose <strong>Customer pays</strong> (charged at checkout) or{" "}
              <strong>You pay</strong> (free to the customer, you still pay the
              Kourify usage fee).
            </s-paragraph>

            <p className="app-guide__sub">Pricing</p>
            <ul className="app-guide__list">
              <li>
                <strong>Flat fee</strong> — a fixed amount per order.
              </li>
              <li>
                <strong>Percentage of order</strong> — scales with order value,
                with a minimum (floor) and maximum (ceiling).
              </li>
            </ul>
            <s-banner tone="info">
              Percentage pricing only takes effect at checkout on Shopify Plus.
              On other plans, customers are charged the flat fee — so use a flat
              fee, or cover it yourself, to keep what they pay matching what&apos;s
              shown.
            </s-banner>

            <p className="app-guide__sub">Claim reasons</p>
            <s-paragraph>
              Pick which reasons appear in the storefront claim form (lost,
              damaged, stolen, shortage, concealed damage, wrong item). If none
              are selected, all six show by default.
            </s-paragraph>

            <p className="app-guide__sub">Filing windows</p>
            <s-paragraph>
              Set how many days after an order ships each claim type can be
              filed. Kourify checks this against the order&apos;s real
              fulfillment date and rejects out-of-window claims automatically.
            </s-paragraph>
          </Card>
        </div>

        <div id="badges">
          <Card heading="Trust badges & storefront widgets">
            <s-paragraph>
              Manage badges from <Link to="/app/badges">Trust badges</Link>: turn
              them on, choose a style, and decide whether they show on product
              pages and the cart.
            </s-paragraph>
            <s-paragraph>
              To make them appear, open your Shopify theme editor and add the
              Kourify blocks (trust badge, the &quot;Protect your order&quot;
              widget, and the guarantee tab) to your product and cart templates.
              They read your settings automatically — no code.
            </s-paragraph>
          </Card>
        </div>

        <div id="customer-claim">
          <Card heading="How customers file a claim">
            <s-paragraph>
              Customers open your storefront claim page and complete four short
              steps: order details, contact, the issue, and a review.
            </s-paragraph>
            <ul className="app-guide__list">
              <li>
                The email they enter <strong>must match</strong> the order&apos;s
                email — this is how Kourify verifies the claim.
              </li>
              <li>The order must have <strong>shipped</strong> before a claim can be filed.</li>
              <li>
                A <strong>photo is required</strong> for damaged and
                concealed-damage claims.
              </li>
              <li>Claims outside your filing window are rejected automatically.</li>
            </ul>
          </Card>
        </div>

        <div id="managing-claims">
          <Card heading="Managing claims">
            <s-paragraph>
              The <Link to="/app/claims">Claims</Link> page lists everything filed
              from your storefront. Filter with the tabs (All, Requires
              evidence, High risk, Resolved today), or search by order number,
              name, or email. Long lists are paginated.
            </s-paragraph>
            <p className="app-guide__sub">Statuses</p>
            <ul className="app-guide__list">
              <li><strong>Submitted</strong> → just received.</li>
              <li><strong>Reviewing</strong> → you&apos;re looking into it.</li>
              <li><strong>Resolved</strong> → approved / handled.</li>
              <li><strong>Denied</strong> → not approved.</li>
            </ul>
            <s-banner tone="warning">
              Setting a claim to Resolved or Denied emails the customer straight
              away, so Kourify asks you to confirm first.
            </s-banner>
            <s-paragraph>
              Each row flags a high-risk order and a repeat claim from the same
              email, shows the evidence photo, and links to the Shopify order.
              Use <strong>Export CSV</strong> to download the list.
            </s-paragraph>
          </Card>
        </div>

        <div id="orders">
          <Card heading="Orders & offers">
            <s-paragraph>
              The <Link to="/app/orders">Orders</Link> page shows which orders are
              protected. For an unprotected, unfulfilled order you can:
            </s-paragraph>
            <ul className="app-guide__list">
              <li>
                <strong>Send offer</strong> — email the customer a post-purchase
                protection offer (valid 48 hours). Protection applies only after
                they pay.
              </li>
              <li>
                <strong>Fulfill</strong> — add tracking and fulfill a protected
                order.
              </li>
              <li>
                <strong>Mark delivered</strong> — record actual delivery, which
                the claim windows are measured from.
              </li>
            </ul>
          </Card>
        </div>

        <div id="languages">
          <Card heading="Languages">
            <s-paragraph>
              Translate the storefront claim page from{" "}
              <Link to="/app/translations">Languages</Link>. Add locales (for example
              Arabic or Hindi, with right-to-left support), set a default, and
              edit any label. Blank fields fall back to English, and shoppers can
              switch language on the claim page without a reload.
            </s-paragraph>
          </Card>
        </div>

        <div id="order-sync">
          <Card heading="Order sync">
            <s-paragraph>
              Kourify caches your orders so it can verify claims quickly. New
              orders sync automatically via webhooks; use{" "}
              <Link to="/app/order-sync">Order sync</Link> to import existing orders.
              A full sync requires Shopify&apos;s protected customer-data approval
              to be in place.
            </s-paragraph>
          </Card>
        </div>

        <div id="faq">
          <Card heading="Notes & FAQ">
            <p className="app-guide__sub">Is this real insurance?</p>
            <s-paragraph>
              No. It&apos;s a self-funded guarantee you stand behind, and claims
              are reviewed manually. Connect a real insurance partner before
              promising automatic payouts.
            </s-paragraph>
            <p className="app-guide__sub">What&apos;s the $0.60 fee?</p>
            <s-paragraph>
              On the Usage plan, Kourify bills $0.60 per completed protected
              order. It&apos;s waived on Unlimited. You&apos;re never charged for
              unprotected orders.
            </s-paragraph>
            <p className="app-guide__sub">Privacy</p>
            <s-paragraph>
              Claims store only what&apos;s needed to verify them, and Kourify
              handles Shopify&apos;s data-request and redaction webhooks. Customer
              data is never shared across stores.
            </s-paragraph>
          </Card>
        </div>
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
