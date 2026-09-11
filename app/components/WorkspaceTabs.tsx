type Active = "orders" | "claims" | "order-sync";

type Counts = { orders?: number; claims?: number };

const TABS: Array<{ id: Active; label: string; href: string }> = [
  { id: "orders", label: "Orders", href: "/app/orders" },
  { id: "claims", label: "Claims", href: "/app/claims" },
  { id: "order-sync", label: "Order sync", href: "/app/order-sync" },
];

/**
 * Sub-navigation for the Orders / Claims / Order sync workspace. Each tab is
 * still its own route — this only marks which one you're on.
 *
 * App Home has no tabs component, so this is a button group: the current view
 * is the pressed one, and a count rides in the label rather than as a badge,
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

  // paddingBlockEnd sets the nav strip apart from the content below, so the
  // tabs read as their own bar rather than crowding the first section.
  return (
    <s-box paddingBlockEnd="large">
      <s-stack
        direction="inline"
        gap="small-200"
        accessibilityLabel="Orders, claims and order sync"
      >
        {TABS.map((tab) => {
          const count = countFor(tab.id);
          return (
            <s-button
              key={tab.id}
              href={tab.href}
              variant={tab.id === active ? "primary" : "secondary"}
            >
              {count > 0
                ? `${tab.label} (${count > 99 ? "99+" : count})`
                : tab.label}
            </s-button>
          );
        })}
      </s-stack>
    </s-box>
  );
}
