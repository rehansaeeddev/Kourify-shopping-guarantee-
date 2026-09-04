import { Link } from "react-router";

type Active = "orders" | "claims" | "order-sync";

type Counts = { orders?: number; claims?: number };

const TABS: Array<{ id: Active; label: string; href: string }> = [
  { id: "orders", label: "Orders", href: "/app/orders" },
  { id: "claims", label: "Claims", href: "/app/claims" },
  { id: "order-sync", label: "Order sync", href: "/app/order-sync" },
];

/**
 * Shared sub-navigation for the Orders / Claims / Order sync workspace. Each
 * tab is still its own route — this only styles the links and marks the active
 * one — so every page keeps its own loader and action. An optional per-tab
 * count renders a notification badge (like an unread-message count).
 */
export function WorkspaceTabs({
  active,
  counts,
}: {
  active: Active;
  counts?: Counts;
}) {
  const countFor = (id: Active) =>
    id === "orders" ? counts?.orders : id === "claims" ? counts?.claims : 0;

  return (
    <nav className="app-tabs" aria-label="Orders, claims and order sync">
      {TABS.map((tab) => {
        const count = countFor(tab.id) ?? 0;
        return (
          <Link
            key={tab.id}
            to={tab.href}
            className={
              "app-tab" + (tab.id === active ? " app-tab--active" : "")
            }
            aria-current={tab.id === active ? "page" : undefined}
          >
            {tab.label}
            {count > 0 && (
              <span
                className="app-tab__count"
                aria-label={`${count} needing attention`}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
