import type { ReactNode } from "react";
import { SideMenu } from "@/components/dashboard/ui/side-menu";
import { CUSTOMER_VIEWS, type CustomerView } from "@/lib/dashboard/customers";
import { formatNumber } from "@/lib/format";

// Frame of the customer area (task-13-10): same head and side menu as Anfragen and Verwaltung
export function CustomerShell({ current, counts, title, count, description, toolbar, children }: {
  current: CustomerView | null;
  counts: Record<CustomerView, number> | null;
  title: ReactNode;
  count?: number;
  description: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dash-page rw-page rw-page--tight side-page">
      <header className="side-page__head">
        <div className="side-page__head-text">
          <h1 id="customer-title" className="side-page__title">
            {title}
            {count !== undefined && <span className="side-page__count mono">{formatNumber(count)}</span>}
          </h1>
          <p className="side-page__desc">{description}</p>
        </div>
        {toolbar}
      </header>
      <div className="side-page__grid">
        <SideMenu
          label="Kunden"
          title="Kunden"
          scope={["Stammdaten mit Kundennummer und Standorten.", "Der Telefonassistent findet Kunden nach Nummer und Postleitzahl."]}
          groups={[{
            title: "Kundenstamm",
            items: CUSTOMER_VIEWS.map((view) => ({
              key: view.key,
              label: view.label,
              href: view.key === "aktiv" ? "/dashboard/kunden" : `/dashboard/kunden?ansicht=${view.key}`,
              active: view.key === current,
              count: counts?.[view.key],
            })),
          }]}
        />
        <section className="side-page__main" aria-labelledby="customer-title">{children}</section>
      </div>
    </div>
  );
}
