/**
 * The storefront trust badge exactly as shoppers see it. Shared by the
 * badges page and the dashboard so the two previews can't drift apart —
 * the visual styles live in theme.css under `.app-tb`, mirroring
 * extensions/kourify-badges.
 */
export function TrustBadgePreview({ badgeStyle }: { badgeStyle: string }) {
  return (
    <span className={`app-tb app-tb--${badgeStyle}`}>
      <svg
        className="app-tb__icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 2 4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3Z"
          fill="#065f46"
        />
        <path
          d="M8.3 12.1l2.3 2.3 5-5"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>Guaranteed Safe Checkout</span>
    </span>
  );
}
