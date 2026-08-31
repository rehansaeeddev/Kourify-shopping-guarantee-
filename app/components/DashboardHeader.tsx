import type { ReactNode } from "react";

type DashboardHeaderProps = {
  greeting: string;
  subtitle: string;
  actions?: ReactNode;
};

export function DashboardHeader({ greeting, subtitle, actions }: DashboardHeaderProps) {
  return (
    <div className="app-dash-header">
      <div className="app-dash-header__brand">
        <div className="app-dash-header__brand-icon">
          <s-icon type="shield-check-mark" />
        </div>
        <span>Kourify Shopping Guarantee</span>
      </div>
      <div className="app-dash-header__row">
        <div>
          <h1 className="app-dash-header__greeting">{greeting}</h1>
          <p className="app-dash-header__subtitle">{subtitle}</p>
        </div>
        {actions ? <div className="app-dash-header__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
