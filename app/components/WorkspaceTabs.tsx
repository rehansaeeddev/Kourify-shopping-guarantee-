type Active = "orders" | "claims" | "order-sync";

type Counts = { orders?: number; claims?: number };

const TABS: Array<{ id: Active; label: string; href: string; icon: string }> = [
  { id: "orders", label: "Orders", href: "/app/orders", icon: "order" },
  {
    id: "claims",
    label: "Claims",
    href: "/app/claims",
    icon: "clipboard-checklist",
  },
  {
    id: "order-sync",
    label: "Order sync",
    href: "/app/order-sync",
    icon: "refresh",
  },
];

/**
 * Sub-navigation for the Orders / Claims / Order sync workspace. Each tab is
 * still its own route -- this only marks which one you're on.
 *
 * These render into s-page's action slots, so they have to be direct children
 * of s-page rather than page content: a slot attribute only takes effect on a
 * child of the element that declares the slot.
 *
 * App Home has no tabs component. The view you are on takes the single
 * primary-action slot, which draws it pressed, and the other two sit beside
 * it as secondary actions. A count rides in the label rather than as a badge,
 * since a button takes text and not markup.
 */
export function WorkspaceTabs({
  active,
  counts,
}: {
  active: Active;
  counts?: Counts;
}) {
  const countFor = (id: Active) =>
    (id === "orders" ? counts?.orders : id === "claims" ? counts?.claims : 0) ??
    0;

  return (
    <>
      {TABS.map((tab) => {
        const count = countFor(tab.id);
        const current = tab.id === active;
        return (
          <s-button
            key={tab.id}
            slot={current ? "primary-action" : "secondary-actions"}
            href={tab.href}
            icon={tab.icon as never}
            variant={current ? "primary" : "secondary"}
          >
            {count > 0
              ? `${tab.label} (${count > 99 ? "99+" : count})`
              : tab.label}
          </s-button>
        );
      })}
    </>
  );
}
