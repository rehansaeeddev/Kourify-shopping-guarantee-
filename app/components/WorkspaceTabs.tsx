type Active = "orders" | "claims" | "order-sync";

const TABS: Array<{ id: Active; label: string; href: string }> = [
  { id: "orders", label: "Orders", href: "/app/orders" },
  { id: "claims", label: "Claims", href: "/app/claims" },
  { id: "order-sync", label: "Order sync", href: "/app/order-sync" },
];

/**
 * Shared sub-navigation for the Orders / Claims / Order sync workspace. Each
 * tab is still its own route — this only styles the links and marks the active
 * one — so every page keeps its own loader and action.
 */
export function WorkspaceTabs({ active }: { active: Active }) {
  return (
    <nav className="app-tabs" aria-label="Orders, claims and order sync">
      {TABS.map((tab) => (
        <a
          key={tab.id}
          href={tab.href}
          className={"app-tab" + (tab.id === active ? " app-tab--active" : "")}
          aria-current={tab.id === active ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
