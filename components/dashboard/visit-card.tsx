import Link from "next/link";
import { StatusChip } from "@/components/dashboard/ui/status-chip";
import { Icon } from "@/components/ui";
import type { TechnicianVisit } from "@/lib/dashboard/technician";
import type { DisplayStatus } from "@/lib/display-status";
import { routeHref, telHref } from "@/lib/contact-links";
import { formatElapsed, formatTime, formatWeekdayDate } from "@/lib/format";
import { label } from "@/lib/status";

// Technician views (task-6-1, redesigned in task-10-3 for 390 px): everything needed on site.
// Targets are at least 44 px, the main action 52 px.

const VISIT_STATUS: Record<string, DisplayStatus> = {
  scheduled: { key: "geplant", label: "Geplant", tone: "run" },
  in_progress: { key: "laeuft", label: "Läuft", tone: "act" },
  waiting_parts: { key: "teile", label: "Wartet auf Teile", tone: "wait" },
  completed: { key: "erledigt", label: "Erledigt", tone: "done" },
  cancelled: { key: "storniert", label: "Storniert", tone: "closed" },
};

export function visitStatus(status: string): DisplayStatus {
  return VISIT_STATUS[status] ?? { key: status, label: status, tone: "wait" };
}

export function addressOf(request: TechnicianVisit["request"]) {
  return `${request.street_house_number}, ${request.postal_code} ${request.city}`;
}

// Order, address and contact with call and route buttons (also on the visit page)
export function OrderFacts({ request }: { request: TechnicianVisit["request"] }) {
  const address = addressOf(request);
  return (
    <>
      {request.description && <p className="tech-description">{request.description}</p>}
      <dl className="tech-facts">
        <div><dt>Adresse</dt><dd>{address}{request.site_label && <> · {request.site_label}</>}</dd></div>
        <div><dt>Kontakt</dt><dd>{request.contact_name}</dd></div>
      </dl>
      <p className="tech-buttons">
        <a className="rw-button-secondary" href={telHref(request.phone_number)}><Icon name="phone" size={18} />Anrufen</a>
        <a className="rw-button-secondary" href={routeHref(address)} target="_blank" rel="noopener noreferrer"><Icon name="location" size={18} />Route</a>
      </p>
    </>
  );
}

const ACTION: Record<string, string> = { scheduled: "Einsatz öffnen und starten", in_progress: "Einsatz fortsetzen", waiting_parts: "Einsatz öffnen" };

// The running or next visit as large card "Jetzt"
export function NowCard({ visit, now }: { visit: TechnicianVisit; now: number }) {
  const r = visit.request;
  const running = visit.status === "in_progress" && visit.actual_start;
  return (
    <article className={`rw-card ${running ? "rw-card--action" : "rw-card--neutral"} tech-now`}>
      <p className="tech-now__time">
        <span className="mono">{formatTime(visit.scheduled_start)}–{formatTime(visit.scheduled_end)}</span>
        <StatusChip status={running ? { ...visitStatus("in_progress"), label: `Läuft · ${formatElapsed((now - new Date(visit.actual_start!).getTime()) / 60000)}` } : visitStatus(visit.status)} />
      </p>
      <h3 className="tech-now__title"><Link href={`/dashboard/anfragen/${r.id}`}>{r.company_name}</Link></h3>
      <p className="tech-meta"><span className="mono">{r.request_number}</span> · {label("service_kind", r.service_kind)} · {label("equipment_kind", r.equipment_kind)}</p>
      {r.safety_risk !== "none_known" && <p className="rw-hazard"><Icon name="hazard" size={16} />Sicherheitsgefahr: {label("safety_risk", r.safety_risk)} – vor Arbeitsbeginn klären</p>}
      {visit.status === "waiting_parts" && visit.waiting_reason && <p className="rw-blocked">Wartet auf Teile: {visit.waiting_reason}</p>}
      <OrderFacts request={r} />
      {visit.status !== "cancelled" && visit.status !== "completed" && (
        <Link className="button button--primary tech-main visit-card__open" href={`/dashboard/einsatz/${visit.id}`}>{ACTION[visit.status] ?? "Einsatz öffnen"}</Link>
      )}
    </article>
  );
}

// One row of the day list
export function VisitRow({ visit, showDate = false }: { visit: TechnicianVisit; showDate?: boolean }) {
  const r = visit.request;
  return (
    <li className="tech-row">
      <span className="tech-row__time mono">{showDate && <span className="tech-row__date">{formatWeekdayDate(visit.scheduled_start).replace(/\d{4}$/, "")}</span>}{formatTime(visit.scheduled_start)}</span>
      <Link className="tech-row__body visit-card__open" href={`/dashboard/einsatz/${visit.id}`}>
        <span className="tech-row__head"><strong>{r.company_name}</strong><StatusChip status={visitStatus(visit.status)} /></span>
        <span className="tech-meta">{label("service_kind", r.service_kind)} · {label("equipment_kind", r.equipment_kind)} · {r.city}</span>
      </Link>
    </li>
  );
}

