import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="app-banner">
      <div>
        <h1 className="app-banner__title">{title}</h1>
        {subtitle ? <p className="app-banner__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="app-banner__actions">{actions}</div> : null}
    </div>
  );
}
