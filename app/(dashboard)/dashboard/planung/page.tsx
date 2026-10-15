import type { Metadata } from "next";
import Link from "next/link";
import { PlanBoard, type BoardPick } from "@/components/dashboard/plan-board";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { PriorityText, RequestStatusChip } from "@/components/dashboard/ui/status-chip";
import { Icon } from "@/components/ui";
import { addDays, berlinToInstant, dayKeyOf, isDayKey, isoWeek, isoWeekday, isTime } from "@/lib/berlin-time";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getEmployeeNames } from "@/lib/dashboard/requests";
import { loadAvailability, loadMonthLoads, loadPlanningDays, loadSelectedContext, type Availability, type WorkingHours } from "@/lib/dashboard/planning";
import { formatCalendarDate, formatDate, formatDateTime, formatNumber, formatWeekdayDate } from "@/lib/format";
import { hoursOn, nextWorkingDays, SLOT_DURATIONS } from "@/lib/slot-suggestions";
import { label } from "@/lib/status";

export const metadata: Metadata = { title: "Einsatzplanung" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const shortDay = (day: string) => formatWeekdayDate(`${day}T12:00:00Z`).replace(/\d{4}$/, "");
const workday = (day: string) => (isoWeekday(day) > 5 ? nextWorkingDays(day, 1)[0] : day);

// Visit planning (task-5-x; redesigned in task-10-3 after the user's dashboard draft "Einsatzplanung Redesign"):
// queue of requests to plan, one planning board for 7 working days or a single day (components/dashboard/plan-board.tsx)
// and the booking panel with suggestions (lib/slot-suggestions.ts). Picking a slot happens in the browser;
// ?woche= is the first day of the 7-working-day window, ?ansicht=tag&tag= the day view.
export default async function PlanningPage({ searchParams }: Props) {
  const employee = await requireRole(rolesFor("/dashboard/planung"));
  const params = await searchParams;
  const today = dayKeyOf(new Date());
  const dayView = single(params.ansicht) === "tag";
  const focusDay = workday(isDayKey(single(params.tag)) ? single(params.tag) : today);
  const anchor = workday(isDayKey(single(params.woche)) ? single(params.woche) : today);
  const days = dayView ? [focusDay] : nextWorkingDays(anchor, 7);
  const data = await loadPlanningDays(employee, days, single(params.anfrage) || undefined);
  const durationParam = Number.parseInt(single(params.dauer), 10);
  const duration = (SLOT_DURATIONS as readonly number[]).includes(durationParam) ? durationParam : 120;
  const selected = data.selected;
  const [availability, context, names, monthLoads] = await Promise.all([
    loadAvailability(selected?.id ?? null, data.technicians, data.workingHours, duration),
    selected?.id ? loadSelectedContext(selected.id) : Promise.resolve(null),
    getEmployeeNames(),
    // Load next to the names: calendar month of the first shown day (task-12-1)
    loadMonthLoads(days[0], data.technicians, data.workingHours),
  ]);

  // Chosen slot from the URL (suggestion, board click or a shared link)
  const pickTech = single(params.techniker);
  const pickDay = single(params.datum);
  const pickStart = single(params.beginn);
  const pick: BoardPick | null = selected && data.technicians.some((tech) => tech.id === pickTech) && isDayKey(pickDay) && isTime(pickStart)
    ? { technicianId: pickTech, day: pickDay, start: pickStart, end: toTime(Math.min(toMinutes(pickStart) + duration, 23 * 60 + 30)) }
    : null;

  const link = (overrides: Record<string, string | null>) => {
    const query = new URLSearchParams();
    const base: Record<string, string | null> = { woche: dayView ? null : anchor, ansicht: dayView ? "tag" : null, tag: dayView ? focusDay : null, anfrage: selected?.id ?? null, dauer: String(duration) };
    for (const [key, value] of Object.entries({ ...base, ...overrides })) if (value) query.set(key, value);
    return `/dashboard/planung?${query.toString()}`;
  };
  const techName = (id: string) => data.technicians.find((tech) => tech.id === id)?.name ?? names.get(id) ?? "Unbekannt";
  const figures = capacityFigures(availability, data.technicians.map((tech) => tech.id), data.workingHours);
  const first = availability.suggestions.slice().sort((a, b) => a.start.localeCompare(b.start))[0];
  const waiting = data.queue.length;

  const requestSummary = selected && (
    <div className="plan3__req">
      <div className="plan3__req-top">
        <Link className="mono" href={`/dashboard/anfragen/${selected.id}`}>{selected.request_number}</Link>
        <RequestStatusChip intakeStatus="processed" workStatus={selected.work_status} />
      </div>
      <strong className="plan3__req-name">{selected.company_name}</strong>
      <span className="plan3__muted">{selected.city} · {label("service_kind", selected.service_kind)} · <PriorityText priority={selected.priority} /></span>
      {selected.due_at && <span className="plan3__muted">Servicefrist <span className="mono">{formatDateTime(selected.due_at)}</span></span>}
      {context && context.visits.length > 0 && (
        <span className="plan3__muted">Folgeeinsatz · Ersteinsatz am <span className="mono">{formatDate(context.visits[0].start)}</span> durch {techName(context.visits[0].technicianId)}</span>
      )}
      {context && context.orderedParts.length > 0 && (
        <p className="rw-blocked">
          Wartet auf Teile: {context.orderedParts.map((part) => `${formatNumber(part.quantity)} × ${part.description}, bestellt am ${formatCalendarDate(part.orderedAt.slice(0, 10))}`).join("; ")}. Termin so wählen, dass das Teil vorher da ist.
        </p>
      )}
      {selected.safety_check_required && (
        <p className="rw-blocked">Automatisch bearbeitet mit Sicherheitsgefahr: vor der Planung auf der Anfrageseite prüfen (z. B. Analyse korrigieren).</p>
      )}
    </div>
  );

  const emptyPanel = data.selectedPlanned ? (
    <EmptyState title={`${data.selectedPlanned.request_number} braucht keine Planung mehr.`} action={<Link className="rw-button-secondary" href={`/dashboard/anfragen/${data.selectedPlanned.id}`}>Zur Anfrage</Link>}>
      Sie ist eingeplant oder nicht mehr offen.
    </EmptyState>
  ) : waiting === 0 ? (
    <EmptyState tone="good" title="Alle Anfragen sind eingeplant">Sobald eine Anfrage einen Einsatz braucht, erscheint sie links mit Terminvorschlägen.</EmptyState>
  ) : (
    <EmptyState title="Anfrage auswählen">Links eine Anfrage wählen; danach erscheinen Terminvorschläge je Techniker.</EmptyState>
  );

  return (
    <div className="dash-page rw-page rw-page--tight plan3-page">
      <header className="plan3__head">
        <div>
          <p className="plan3__eyebrow">Disposition · KW {isoWeek(today)}</p>
          <h1>Einsatzplanung</h1>
          <p className="plan3__takeaway">
            <strong>{waiting === 0 ? "Alle Anfragen sind eingeplant." : waiting === 1 ? "1 Anfrage wartet auf einen Termin." : `${waiting} Anfragen warten auf einen Termin.`}</strong>
            {selected && first && <> Für {selected.request_number} ist {first.name} am {shortDay(first.day)} ab <span className="mono">{first.startTime}</span> am frühesten frei.</>}
          </p>
        </div>
        <dl className="plan3__kpis" aria-label="Kennzahlen der nächsten 7 Arbeitstage">
          <div className="plan3__kpi plan3__kpi--action"><dt>Zu planen</dt><dd>{formatNumber(waiting)}</dd></div>
          <div className="plan3__kpi"><dt>Freie Stunden</dt><dd>{formatNumber(figures.freeHours)}<small>h</small></dd></div>
          <div className="plan3__kpi"><dt>Auslastung</dt><dd>{formatNumber(figures.loadPercent)}<small>%</small></dd></div>
          <div className="plan3__kpi"><dt>Geplante Einsätze</dt><dd>{formatNumber(figures.visits)}</dd></div>
          <p className="plan3__kpi-note">Nächste 7 Arbeitstage · <span className="mono">{shortDay(availability.days[0])} – {shortDay(availability.days[availability.days.length - 1])}</span></p>
        </dl>
      </header>

      {(data.error || availability.error || monthLoads.error) && (
        <ErrorState title="Ein Teil der Planungsdaten konnte nicht geladen werden." action={<Link className="rw-button-secondary" href={link({})}>Erneut versuchen</Link>}>
          Angezeigte Belegungen können unvollständig sein.
        </ErrorState>
      )}

      <div className="plan3">
        <aside className="rw-card rw-card--meta plan3__queue" aria-labelledby="queue-title">
          <header className="plan3__queue-head">
            <h2 id="queue-title" className="rw-card__title">Zu planen <span className="rw-card__count mono">{waiting}</span></h2>
            <span className="plan3__eyebrow">Priorität · Frist</span>
          </header>
          {waiting === 0 ? (
            <p className="plan3__idle"><Icon name="check-circle" size={18} />Alle Anfragen sind eingeplant.</p>
          ) : (
            <ul className="plan3__list">
              {data.queue.map((row) => (
                <li key={row.id}>
                  <Link href={link({ anfrage: row.id })} className="plan3__item" aria-current={row.id === selected?.id ? "true" : undefined} scroll={false}>
                    <span className="plan3__item-head"><span className="mono">{row.request_number}</span><PriorityText priority={row.priority} /></span>
                    <strong>{row.company_name}</strong>
                    <span className="plan3__muted">{row.city} · {label("service_kind", row.service_kind)}</span>
                    {row.work_status === "waiting_parts" && <span className="rw-flag rw-flag--info">Folgeeinsatz · wartet auf Teile</span>}
                    {row.safety_check_required && <span className="rw-hazard"><Icon name="hazard" size={14} />Sicherheitsprüfung nötig</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <PlanBoard
          key={selected?.id ?? "none"}
          technicians={data.technicians}
          workingHours={data.workingHours}
          busy={data.busy}
          availability={{ days: availability.days, now: availability.now, busy: availability.busy, experience: availability.experience }}
          view={dayView ? "tag" : "woche"}
          days={days}
          anchor={anchor}
          focusDay={focusDay}
          request={selected?.id ? { id: selected.id, version: selected.version ?? 0, number: selected.request_number ?? "" } : null}
          requestSummary={requestSummary}
          emptyPanel={emptyPanel}
          initialDuration={duration}
          initialPick={pick}
          monthLoads={{ month: monthLoads.month, loads: monthLoads.loads }}
        />
      </div>
    </div>
  );
}

// Free hours, load and planned visits of all technicians within the suggestion window (working hours only)
function capacityFigures(availability: Availability, technicianIds: string[], workingHours: WorkingHours[]) {
  let capacity = 0;
  let busy = 0;
  for (const technicianId of technicianIds) {
    const blocks = availability.busy.filter((block) => block.technicianId === technicianId).map((block) => ({ start: Date.parse(block.start), end: Date.parse(block.end) }));
    for (const day of availability.days) {
      for (const row of hoursOn(workingHours, technicianId, day)) {
        const from = berlinToInstant(day, row.start).getTime();
        const to = berlinToInstant(day, row.end).getTime();
        capacity += to - from;
        busy += blocks.reduce((sum, block) => sum + Math.max(0, Math.min(block.end, to) - Math.max(block.start, from)), 0);
      }
    }
  }
  const lastDay = berlinToInstant(addDays(availability.days[availability.days.length - 1], 1), "00:00").getTime();
  const firstDay = berlinToInstant(availability.days[0], "00:00").getTime();
  return {
    freeHours: Math.round(Math.max(0, capacity - busy) / 3600000),
    loadPercent: capacity > 0 ? Math.round((busy / capacity) * 100) : 0,
    visits: availability.busy.filter((block) => block.kind === "visit" && Date.parse(block.start) < lastDay && Date.parse(block.end) > firstDay).length,
  };
}
