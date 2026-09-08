import type { ReactNode } from "react";

/**
 * A small labelled chip that reveals help text in a tooltip on hover or
 * keyboard focus. Used to fold away a full "aside" panel into the header
 * while keeping the copy one hover away.
 */
export function InfoTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="app-infotip">
      <button type="button" className="app-infotip__trigger">
        <span className="app-infotip__icon" aria-hidden="true">
          i
        </span>
        {label}
      </button>
      <span role="tooltip" className="app-infotip__bubble">
        {children}
      </span>
    </span>
  );
}
