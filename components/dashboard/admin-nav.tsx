import type { ReactNode } from "react";
import { SideMenu } from "@/components/dashboard/ui/side-menu";
import { formatNumber } from "@/lib/format";

// Sub-navigation of the administration area (task-8-1); since task-10-3 (user feedback 13.10.2026) the
// side menu of the list pages with the area's own head, so Verwaltung looks like Anfragen and Rechnungen
const GROUPS = [
  {
    title: "Personal",
    items: [
      { key: "mitarbeitende", href: "/dashboard/verwaltung", label: "Mitarbeitende" },
      { key: "arbeitszeiten", href: "/dashboard/verwaltung/arbeitszeiten", label: "Arbeitszeiten" },
    ],
  },
  {
    title: "Abrechnung",
    items: [
      { key: "tarife", href: "/dashboard/verwaltung/tarife", label: "Tarife" },
      { key: "einstellungen", href: "/dashboard/verwaltung/einstellungen", label: "Einstellungen" },
    ],
  },
] as const;

type Area = (typeof GROUPS)[number]["items"][number]["key"];

export function AdminShell({ current, title, count, description, actions, children }: {
  current: Area;
  title: ReactNode;
  count?: number;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dash-page rw-page rw-page--tight side-page admin-page">
      <header className="side-page__head">
        <div className="side-page__head-text">
          <h1 id="admin-title" className="side-page__title">
            {title}
            {count !== undefined && <span className="side-page__count mono">{formatNumber(count)}</span>}
          </h1>
          <p className="side-page__desc">{description}</p>
        </div>
        {actions}
      </header>
      <div className="side-page__grid">
        <SideMenu
          label="Verwaltung"
          title="Verwaltung"
          scope={["Mitarbeitende werden deaktiviert, nicht gelöscht.", "Änderungen gelten für spätere Vorgänge."]}
          groups={GROUPS.map((group) => ({
            title: group.title,
            items: group.items.map((item) => ({ key: item.key, label: item.label, href: item.href, active: item.key === current })),
          }))}
        />
        <section className="side-page__main" aria-labelledby="admin-title">{children}</section>
      </div>
    </div>
  );
}
