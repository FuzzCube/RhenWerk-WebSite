import type { ReactNode } from "react";
import { SideMenu } from "@/components/dashboard/ui/side-menu";
import { CALL_VIEWS, type CallView } from "@/lib/dashboard/calls";
import { formatNumber } from "@/lib/format";

// Frame of the call area (task-13-7): same head and side menu as Kunden and Anfragen
export function CallShell({ current, counts, title, count, description, toolbar, children }: {
  current: CallView | null;
  counts: Record<CallView, number> | null;
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
          <h1 id="call-title" className="side-page__title">
            {title}
            {count !== undefined && <span className="side-page__count mono">{formatNumber(count)}</span>}
          </h1>
          <p className="side-page__desc">{description}</p>
        </div>
        {toolbar}
      </header>
      <div className="side-page__grid">
        <SideMenu
          label="Anrufe"
          title="Anrufe"
          scope={["Gespräche des Telefonassistenten Mira mit Zusammenfassung.", "Transkripte werden nach 30 Tagen gelöscht."]}
          groups={[{
            title: "Telefonassistent",
            items: CALL_VIEWS.map((view) => ({
              key: view.key,
              label: view.label,
              href: view.key === "alle" ? "/dashboard/anrufe" : `/dashboard/anrufe?ansicht=${view.key}`,
              active: view.key === current,
              count: counts?.[view.key],
            })),
          }]}
        />
        <section className="side-page__main" aria-labelledby="call-title">{children}</section>
      </div>
    </div>
  );
}
