import type { Metadata } from "next";
import Link from "next/link";
import { visitStatus } from "@/components/dashboard/visit-card";
import { ErrorState } from "@/components/dashboard/ui/states";
import { HazardFlag, StatusChip } from "@/components/dashboard/ui/status-chip";
import { Icon } from "@/components/ui";
import { addDays, dayKeyOf, isoWeek, isoWeekday, minutesOfDay } from "@/lib/berlin-time";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadWeek } from "@/lib/dashboard/technician";
import { formatNumber, formatTime, formatWeekdayDate } from "@/lib/format";
import { hoursOn } from "@/lib/slot-suggestions";
import { label } from "@/lib/status";

export const metadata: Metadata = { title: "Kalender" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type WeekData = Awaited<ReturnType<typeof loadWeek>>;
type Entry =
  | { kind: "visit"; start: string; end: string; visit: WeekData["visits"][number] }
  | { kind: "absence"; start: string; end: string };

const shortDay = (day: string) => formatWeekdayDate(`${day}T12:00:00Z`).replace(/\d{4}$/, "");
const dayName = (day: string) => new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

// Own week only: visits and absences of the signed-in technician (redesigned in task-10-3 after user
// feedback 12.10.2026): one agenda per day instead of a time lane plus a repeated list. Days side by
// side from tablet width, stacked on the phone.
export default async function CalendarPage({ searchParams }: Props) {
  const employee = await requireRole(rolesFor("/dashboard/kalender"));
  const params = await searchParams;
  const data = await loadWeek(employee.id, typeof params.woche === "string" ? params.woche : undefined);
  const today = dayKeyOf(new Date());
  const link = (week: string, day?: string) => `/dashboard/kalender?woche=${week}${day ? `&tag=${day}` : ""}`;

  // The part of an interval on one Berlin day
  const covers = (start: string, end: string, day: string) => dayKeyOf(new Date(start)) <= day && dayKeyOf(new Date(Date.parse(end) - 1)) >= day;
  const entriesOn = (day: string): Entry[] => [
    ...data.visits.filter((visit) => covers(visit.scheduled_start, visit.scheduled_end, day)).map((visit) => ({ kind: "visit" as const, start: visit.scheduled_start, end: visit.scheduled_end, visit })),
    ...data.absences.filter((absence) => covers(absence.start, absence.end, day)).map((absence) => ({ kind: "absence" as const, ...absence })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  // Weekend days only when there is work or something booked
  const days = data.days.filter((day) => isoWeekday(day) <= 5 || hoursOn(data.workingHours, employee.id, day).length > 0 || entriesOn(day).length > 0);
  const openVisits = data.visits.filter((visit) => ["scheduled", "in_progress", "waiting_parts"].includes(visit.status)).length;
  // Phone and tablet show one day at a time (?tag=), chosen in the week strip; default today or the first day
  const dayParam = typeof params.tag === "string" ? params.tag : "";
  const selected = days.includes(dayParam) ? dayParam : days.includes(today) ? today : days[0];
  const visitCount = (day: string) => entriesOn(day).filter((entry) => entry.kind === "visit").length;
  const absent = (day: string) => entriesOn(day).some((entry) => entry.kind === "absence");

  return (
    <div className="dash-page cal-page">
      <header className="cal-head">
        <div>
          <h1>Kalender</h1>
          <p className="cal-head__range">
            <strong>KW {isoWeek(data.week)}</strong> <span className="mono">{shortDay(data.week)} – {shortDay(addDays(data.week, 6))}</span>
            <span className="cal-head__sum"> · {data.visits.length === 1 ? "1 Einsatz" : `${formatNumber(data.visits.length)} Einsätze`}{openVisits !== data.visits.length && <>, davon {formatNumber(openVisits)} offen</>}</span>
          </p>
        </div>
        <nav className="cal-nav" aria-label="Woche wechseln">
          <Link href={link(addDays(data.week, -7))} aria-label="Vorherige Woche" title="Vorherige Woche"><Icon name="arrow-left" size={16} /></Link>
          <Link href={link(today)} aria-current={days.includes(today) ? "true" : undefined}>Heute</Link>
          <Link href={link(addDays(data.week, 7))} aria-label="Nächste Woche" title="Nächste Woche"><Icon name="arrow-right" size={16} /></Link>
        </nav>
      </header>

      {data.error && <ErrorState><p>Ein Teil der Daten konnte nicht geladen werden. Bitte die Seite neu laden.</p></ErrorState>}

      {/* Phone and tablet: week strip and the agenda of one day */}
      <nav className="cal-strip" aria-label="Tag wählen" style={{ ["--cal-days" as string]: days.length }}>
        {days.map((day) => {
          const count = visitCount(day);
          return (
            <Link
              key={day}
              href={link(data.week, day)}
              scroll={false}
              aria-current={day === selected ? "date" : undefined}
              aria-label={`${dayName(day)}, ${shortDay(day)}: ${count === 1 ? "1 Einsatz" : `${count} Einsätze`}${absent(day) ? ", abwesend" : ""}`}
              className={`cal-strip__day${day === today ? " is-today" : ""}${count === 0 ? " is-free" : ""}`}
            >
              <span className="cal-strip__name">{dayName(day).slice(0, 2)}</span>
              <span className="cal-strip__date">{Number(day.slice(8, 10))}</span>
              <span className="cal-strip__count mono">{absent(day) && count === 0 ? "–" : count}</span>
            </Link>
          );
        })}
      </nav>
      <section className="cal-agenda" aria-labelledby="agenda-title">
        <header className="cal-agenda__head">
          <h2 id="agenda-title">{selected === today ? "Heute" : dayName(selected)}, <span className="mono">{shortDay(selected)}</span></h2>
          <span className="cal-agenda__hours">
            {hoursOn(data.workingHours, employee.id, selected).length
              ? <>Arbeitszeit <span className="mono">{hoursOn(data.workingHours, employee.id, selected).map((row) => `${row.start}–${row.end}`).join(", ")}</span></>
              : "Kein Arbeitstag"}
          </span>
        </header>
        {entriesOn(selected).length === 0 ? (
          <p className="cal-agenda__empty"><Icon name="check-circle" size={18} />Keine Einsätze an diesem Tag.</p>
        ) : (
          <ol className="cal-agenda__list">
            {entriesOn(selected).map((entry) => {
              const [from, to] = timeOn(entry.start, entry.end, selected).split("–");
              return (
                <li key={entry.kind === "visit" ? entry.visit.id : `a-${entry.start}`} className="cal-agenda__row">
                  <span className="cal-agenda__time mono">{to ? <>{from}<small>{to}</small></> : from}</span>
                  {entry.kind === "absence" ? (
                    <div className="cal-item cal-item--absence"><strong>Abwesend</strong></div>
                  ) : (
                    <Link className={`cal-item cal-item--visit${["completed", "cancelled"].includes(entry.visit.status) ? " is-done" : ""}`} href={`/dashboard/einsatz/${entry.visit.id}`}>
                      <span className="cal-item__row">
                        <strong className="cal-item__title">{entry.visit.request.company_name}</strong>
                        <StatusChip status={visitStatus(entry.visit.status)} />
                      </span>
                      <span className="cal-item__meta"><span className="mono">{entry.visit.request.request_number}</span> · {label("service_kind", entry.visit.request.service_kind)} · {label("equipment_kind", entry.visit.request.equipment_kind)}</span>
                      <span className="cal-item__place"><Icon name="location" size={16} />{entry.visit.request.street_house_number}, {entry.visit.request.postal_code} {entry.visit.request.city}</span>
                      <HazardFlag risk={entry.visit.request.safety_risk} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Desktop: the whole week side by side */}
      <ol className="cal-week" style={{ ["--cal-days" as string]: days.length }}>
        {days.map((day) => {
          const entries = entriesOn(day);
          const hours = hoursOn(data.workingHours, employee.id, day);
          const isToday = day === today;
          return (
            <li key={day} className={`cal-day${isToday ? " is-today" : ""}${day < today ? " is-past" : ""}`} aria-current={isToday ? "date" : undefined}>
              <header className="cal-day__head">
                <span className="cal-day__top">{isToday ? "Heute" : dayName(day)}</span>
                <strong>{shortDay(day)}</strong>
                <span className="cal-day__hours">{hours.length ? <span className="mono">{hours.map((row) => `${row.start}–${row.end}`).join(", ")}</span> : "Kein Arbeitstag"}</span>
              </header>
              {entries.length === 0 ? (
                <p className="cal-day__empty">Keine Einsätze</p>
              ) : (
                <ul className="cal-day__list">
                  {entries.map((entry) => entry.kind === "absence" ? (
                    <li key={`a-${entry.start}`} className="cal-item cal-item--absence">
                      <span className="cal-item__time mono">{timeOn(entry.start, entry.end, day)}</span>
                      <strong>Abwesend</strong>
                    </li>
                  ) : (
                    <li key={entry.visit.id}>
                      <Link className={`cal-item cal-item--visit${["completed", "cancelled"].includes(entry.visit.status) ? " is-done" : ""}`} href={`/dashboard/einsatz/${entry.visit.id}`}>
                        <span className="cal-item__row">
                          <span className="cal-item__time mono">{timeOn(entry.start, entry.end, day)}</span>
                          <StatusChip status={visitStatus(entry.visit.status)} />
                        </span>
                        <strong className="cal-item__title">{entry.visit.request.company_name}</strong>
                        <span className="cal-item__meta"><span className="mono">{entry.visit.request.request_number}</span> · {label("service_kind", entry.visit.request.service_kind)} · {entry.visit.request.city}</span>
                        <HazardFlag risk={entry.visit.request.safety_risk} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Time range of an entry on one day; parts of multi-day entries show the day boundary
function timeOn(start: string, end: string, day: string): string {
  const from = dayKeyOf(new Date(start)) < day ? "00:00" : formatTime(start);
  const to = dayKeyOf(new Date(Date.parse(end) - 1)) > day ? "24:00" : formatTime(end);
  if (from === "00:00" && (to === "24:00" || minutesOfDay(new Date(end)) === 0)) return "ganztägig";
  return `${from}–${to}`;
}
