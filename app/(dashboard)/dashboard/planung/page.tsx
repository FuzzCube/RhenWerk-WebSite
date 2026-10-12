import type { Metadata } from "next";
import Link from "next/link";
import { PlanningCalendar } from "@/components/dashboard/planning-calendar";
import { Card } from "@/components/dashboard/ui/card";
import { Legend } from "@/components/dashboard/ui/legend";
import { HiddenField, SaveForm, SelectField, TextField } from "@/components/dashboard/ui/save-form";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { PriorityText, RequestStatusChip } from "@/components/dashboard/ui/status-chip";
import { Icon } from "@/components/ui";
import { addDays, berlinToInstant, dayKeyOf, isDayKey, isoWeek, isTime, minutesOfDay } from "@/lib/berlin-time";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getEmployeeNames } from "@/lib/dashboard/requests";
import { loadAvailability, loadPlanning, loadSelectedContext, type Availability, type PlanningData } from "@/lib/dashboard/planning";
import { formatCalendarDate, formatDate, formatDateTime, formatNumber, formatWeekdayDate } from "@/lib/format";
import { earliestWindow, hoursOn, SLOT_DURATIONS, slotReasonText } from "@/lib/slot-suggestions";
import { label } from "@/lib/status";
import { scheduleVisit } from "./actions";

export const metadata: Metadata = { title: "Einsatzplanung" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const shortDay = (day: string) => formatWeekdayDate(`${day}T12:00:00Z`).replace(/\d{4}$/, "");

// Visit planning (task-5-x, redesigned in task-10-3 after the canvas "Einsatzplanung"): requests to plan,
// suggestions per technician (lib/slot-suggestions.ts), availability of the next 7 working days and
// the booking form. The week calendar below stays for detailed planning.
export default async function PlanningPage({ searchParams }: Props) {
  const employee = await requireRole(rolesFor("/dashboard/planung"));
  const params = await searchParams;
  const today = dayKeyOf(new Date());
  // Calendar view: whole week (default) or a single day (?ansicht=tag&tag=YYYY-MM-DD)
  const dayView = single(params.ansicht) === "tag";
  const dayParam = single(params.tag);
  const focusDay = isDayKey(dayParam) ? dayParam : today;
  const data = await loadPlanning(employee, (dayView ? focusDay : single(params.woche)) || undefined, single(params.anfrage) || undefined);
  const durationParam = Number.parseInt(single(params.dauer), 10);
  const duration = (SLOT_DURATIONS as readonly number[]).includes(durationParam) ? durationParam : 120;
  const selected = data.selected;
  const [availability, context, names] = await Promise.all([
    loadAvailability(selected?.id ?? null, data.technicians, data.workingHours, duration),
    selected?.id ? loadSelectedContext(selected.id) : Promise.resolve(null),
    getEmployeeNames(),
  ]);

  // Chosen slot from a suggestion or a matrix cell
  const pickTech = single(params.techniker);
  const pickDay = single(params.datum);
  const pickStart = single(params.beginn);
  const pick = data.technicians.some((tech) => tech.id === pickTech) && isDayKey(pickDay) && isTime(pickStart)
    ? { technicianId: pickTech, day: pickDay, start: pickStart, end: toTime(Math.min(toMinutes(pickStart) + duration, 23 * 60 + 30)) }
    : null;

  const link = (overrides: Record<string, string | null>) => {
    const query = new URLSearchParams();
    const base: Record<string, string | null> = { woche: dayView ? null : data.week, ansicht: dayView ? "tag" : null, tag: dayView ? focusDay : null, anfrage: selected?.id ?? null, dauer: String(duration), techniker: pick?.technicianId ?? null, datum: pick?.day ?? null, beginn: pick?.start ?? null };
    for (const [key, value] of Object.entries({ ...base, ...overrides })) if (value) query.set(key, value);
    return `/dashboard/planung?${query.toString()}`;
  };
  const choose = (technicianId: string, day: string, start: string) => `${link({ techniker: technicianId, datum: day, beginn: start })}#auswahl`;
  const weekLink = (week: string) => `${link({ woche: week, ansicht: null, tag: null })}#woche`;
  const dayLink = (day: string) => `${link({ woche: null, ansicht: "tag", tag: day })}#woche`;
  const idle = data.queue.length === 0 && !selected && !data.selectedPlanned;
  const techName = (id: string) => data.technicians.find((tech) => tech.id === id)?.name ?? names.get(id) ?? "Unbekannt";

  return (
    <div className="dash-page rw-page rw-page--tight">
      <header className="dash-page-header">
        <div>
          <h1>Einsatzplanung</h1>
          <p className="rw-page__sub">Anfrage wählen, Vorschlag übernehmen oder ein freies Feld in der Matrix anklicken.</p>
        </div>
      </header>
      {(data.error || availability.error) && (
        <ErrorState title="Ein Teil der Planungsdaten konnte nicht geladen werden." action={<Link className="rw-button-secondary" href={link({})}>Erneut versuchen</Link>}>
          Angezeigte Belegungen können unvollständig sein.
        </ErrorState>
      )}

      {idle ? (
        <div className="plan2 plan2--idle">
          <p className="plan2__idle"><Icon name="check-circle" size={18} /><strong>Alle Anfragen sind eingeplant.</strong> Sobald eine Anfrage einen Einsatz braucht, erscheint sie hier mit Terminvorschlägen.</p>
          <Matrix data={data} availability={availability} duration={duration} pick={null} choose={null} />
        </div>
      ) : (
      <div className="plan2">
        <div className="plan2__queue">
          {data.queue.length === 0 ? (
            <Card stripe="success" title="Zu planen" count={0}>
              <EmptyState tone="good" title="Alle Anfragen sind eingeplant">Die Belegung bleibt zur Übersicht sichtbar.</EmptyState>
            </Card>
          ) : (
            <Card stripe="action" title="Zu planen" count={data.queue.length} description="Sortiert nach Priorität, dann nach Frist und Wartezeit.">
              <ul className="plan2__list">
                {data.queue.map((row) => (
                  <li key={row.id}>
                    <Link href={link({ anfrage: row.id, techniker: null, datum: null, beginn: null })} className="plan2__item" aria-current={row.id === selected?.id ? "true" : undefined}>
                      <span className="plan2__item-head"><span className="mono">{row.request_number}</span><PriorityText priority={row.priority} /></span>
                      <strong>{row.company_name}</strong>
                      <span className="cell-sub">{row.city} · {label("service_kind", row.service_kind)}</span>
                      {row.work_status === "waiting_parts" && <span className="rw-flag rw-flag--info">Folgeeinsatz · wartet auf Teile</span>}
                      {row.safety_check_required && <span className="rw-hazard"><Icon name="hazard" size={14} />Sicherheitsprüfung nötig</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="plan2__main">
          {selected ? (
            <>
              <Card stripe="neutral" title={<><Link className="mono" href={`/dashboard/anfragen/${selected.id}`}>{selected.request_number}</Link> · {selected.company_name}</>} action={<RequestStatusChip intakeStatus="processed" workStatus={selected.work_status} />}>
                <p className="rw-card__note">{selected.city} · {label("service_kind", selected.service_kind)}{selected.due_at && <> · Servicefrist <span className="mono">{formatDateTime(selected.due_at)}</span></>}</p>
                {context && context.visits.length > 0 && (
                  <p className="rw-card__note">Folgeeinsatz · Ersteinsatz am <span className="mono">{formatDate(context.visits[0].start)}</span> durch {techName(context.visits[0].technicianId)}</p>
                )}
                {context && context.orderedParts.length > 0 && (
                  <p className="rw-blocked">
                    Wartet auf Teile: {context.orderedParts.map((part) => `${formatNumber(part.quantity)} × ${part.description}, bestellt am ${formatCalendarDate(part.orderedAt.slice(0, 10))}`).join("; ")}. Termin so wählen, dass das Teil vorher da ist.
                  </p>
                )}
                {selected.safety_check_required && (
                  <p className="rw-blocked">Automatisch bearbeitet mit Sicherheitsgefahr: vor der Planung auf der Anfrageseite prüfen (z. B. Analyse korrigieren).</p>
                )}
              </Card>
              <Suggestions availability={availability} duration={duration} pick={pick} link={link} choose={choose} />
              <Matrix data={data} availability={availability} duration={duration} pick={pick} choose={choose} />
              <section id="auswahl" className="rw-card rw-card--action" aria-labelledby="auswahl-title">
                <h2 id="auswahl-title" className="rw-card__title">Auswahl</h2>
                {pick
                  ? <p className="rw-card__note">{techName(pick.technicianId)} · {shortDay(pick.day)} · <span className="mono">{pick.start}–{pick.end}</span>. Uhrzeiten lassen sich vor dem Speichern anpassen.</p>
                  : <p className="rw-card__note">Noch kein Termin gewählt: Vorschlag oder freies Feld anklicken – oder die Felder direkt ausfüllen.</p>}
                <SaveForm key={`${pick?.technicianId}-${pick?.day}-${pick?.start}-${duration}`} action={scheduleVisit} submitLabel="Einsatz planen">
                  <HiddenField name="request_id" value={selected.id ?? ""} />
                  <HiddenField name="version" value={selected.version ?? 0} />
                  <SelectField name="technician_id" label="Techniker" required defaultValue={pick?.technicianId ?? ""} options={data.technicians.map((tech) => ({ value: tech.id, label: tech.name }))} />
                  <div className="form-grid plan-booking__times">
                    <TextField name="date" label="Datum" type="date" required defaultValue={pick?.day ?? addDays(today, 1)} />
                    <TextField name="start" label="Beginn" type="time" required defaultValue={pick?.start ?? "08:00"} />
                    <TextField name="end" label="Ende" type="time" required defaultValue={pick?.end ?? toTime(8 * 60 + duration)} />
                  </div>
                </SaveForm>
              </section>
            </>
          ) : data.selectedPlanned ? (
            <Card title={data.selectedPlanned.request_number}>
              <EmptyState title="Diese Anfrage braucht keine Planung mehr." action={<Link className="rw-button-secondary" href={`/dashboard/anfragen/${data.selectedPlanned.id}`}>Zur Anfrage</Link>}>
                Sie ist eingeplant oder nicht mehr offen.
              </EmptyState>
            </Card>
          ) : (
            <>
              <Card title="Vorschläge">
                <EmptyState title="Anfrage auswählen">{data.queue.length ? "Links eine Anfrage wählen; danach erscheinen Terminvorschläge je Techniker." : "Sobald eine Anfrage einen Einsatz braucht, erscheinen hier Vorschläge."}</EmptyState>
              </Card>
              <Matrix data={data} availability={availability} duration={duration} pick={null} choose={null} />
            </>
          )}
        </div>
      </div>

      )}

      <section id="woche" className="rw-zone" aria-labelledby="calendar-title">
        <div className="rw-zone__header">
          <div className="rw-zone__titles">
            <h2 id="calendar-title">{dayView ? "Tageskalender" : "Wochenkalender"}</h2>
            <span className="rw-zone__note">
              {dayView
                ? <>{formatWeekdayDate(`${focusDay}T12:00:00Z`)} · KW {isoWeek(data.week)}</>
                : <>KW {isoWeek(data.week)} · <span className="mono">{formatDate(`${data.week}T12:00:00Z`)} – {formatDate(`${addDays(data.week, 6)}T12:00:00Z`)}</span></>}
            </span>
          </div>
          <div className="rw-zone__controls">
            <nav className="rw-period" aria-label="Ansicht">
              <ul className="rw-period__kinds">
                <li><Link href={weekLink(dayView ? focusDay : data.week)} aria-current={dayView ? undefined : "page"} scroll={false}>Woche</Link></li>
                <li><Link href={dayLink(dayView ? focusDay : data.days.includes(today) ? today : data.week)} aria-current={dayView ? "page" : undefined} scroll={false}>Tag</Link></li>
              </ul>
            </nav>
            <nav className="plan-week__nav" aria-label={dayView ? "Tag wechseln" : "Woche wechseln"}>
              <Link className="rw-button-secondary" href={dayView ? dayLink(addDays(focusDay, -1)) : weekLink(addDays(data.week, -7))}>← Vorherige</Link>
              <Link className="rw-button-secondary" href={dayView ? dayLink(today) : weekLink(today)}>Heute</Link>
              <Link className="rw-button-secondary" href={dayView ? dayLink(addDays(focusDay, 1)) : weekLink(addDays(data.week, 7))}>Nächste →</Link>
            </nav>
          </div>
        </div>
        <Card stripe="meta">
          <PlanningCalendar days={dayView ? [focusDay] : data.days} technicians={data.technicians} workingHours={data.workingHours} busy={data.busy} canPick={Boolean(selected)} />
        </Card>
      </section>
    </div>
  );
}

type Pick = { technicianId: string; day: string; start: string; end: string } | null;

function Suggestions({ availability, duration, pick, link, choose }: { availability: Availability; duration: number; pick: Pick; link: (o: Record<string, string | null>) => string; choose: (t: string, d: string, s: string) => string }) {
  const durations = (
    <nav className="rw-period" aria-label="Dauer">
      <span className="rw-card__note">Dauer</span>
      <ul className="rw-period__kinds">
        {SLOT_DURATIONS.map((minutes) => (
          <li key={minutes}><Link href={`${link({ dauer: String(minutes), techniker: null, datum: null, beginn: null })}#vorschlaege`} aria-current={minutes === duration ? "page" : undefined} scroll={false}>{minutes / 60} h</Link></li>
        ))}
      </ul>
    </nav>
  );
  return (
    <section id="vorschlaege" className="rw-card rw-card--neutral" aria-labelledby="vorschlaege-title">
      <header className="rw-card__header">
        <div>
          <h2 id="vorschlaege-title" className="rw-card__title">Vorschläge</h2>
          <p className="rw-card__description">Je Techniker das früheste freie Fenster. Zuerst, wer die Firma schon kennt; sonst Erfahrung mit der Anlage, dann geringere Auslastung.</p>
        </div>
        {durations}
      </header>
      {availability.suggestions.length === 0 ? (
        <EmptyState title={`Kein freies Fenster für ${duration / 60} h in den nächsten 7 Arbeitstagen`}>Kürzere Dauer wählen oder im Wochenkalender eine spätere Woche planen.</EmptyState>
      ) : (
        <ul className="plan2__suggestions">
          {availability.suggestions.map((suggestion) => {
            const active = pick?.technicianId === suggestion.technicianId && pick.day === suggestion.day && pick.start === suggestion.startTime;
            return (
              <li key={suggestion.technicianId}>
                <Link className="plan2__suggestion" href={choose(suggestion.technicianId, suggestion.day, suggestion.startTime)} aria-current={active ? "true" : undefined} scroll={false}>
                  <strong>{suggestion.name}</strong>
                  <span className="mono">{shortDay(suggestion.day)} · {suggestion.startTime}–{suggestion.endTime}</span>
                  <span className="plan2__tags">{suggestion.reasons.map((reason) => <span key={reason} className="rw-period-chip">{slotReasonText(reason, suggestion)}</span>)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const DAY_START = 7 * 60;
const DAY_END = 17 * 60;

function Matrix({ data, availability, duration, pick, choose }: { data: PlanningData; availability: Availability; duration: number; pick: Pick; choose: ((t: string, d: string, s: string) => string) | null }) {
  const now = new Date(availability.now);
  const today = dayKeyOf(now);
  const pct = (minutes: number) => `${((Math.min(Math.max(minutes, DAY_START), DAY_END) - DAY_START) / (DAY_END - DAY_START)) * 100}%`;
  const input = { technicians: data.technicians, workingHours: data.workingHours, busy: availability.busy, now, durationMinutes: duration, experience: {} };
  return (
    <section className="rw-card rw-card--meta" aria-labelledby="matrix-title">
      <header className="rw-card__header">
        <h2 id="matrix-title" className="rw-card__title">Verfügbarkeit · nächste 7 Arbeitstage</h2>
        <Legend label="Legende Verfügbarkeit" items={[
          { label: "Frei", color: "var(--rw-surface-raised)" },
          { label: "Belegt", color: "var(--rw-color-blue-500)" },
          { label: "Nicht verfügbar", color: "var(--rw-color-steel-300)" },
          { label: "Vorbei", color: "var(--rw-color-steel-200)" },
          ...(pick ? [{ label: "Auswahl", color: "var(--rw-color-lime-500)" }] : []),
        ]} />
      </header>
      <div className="plan2__matrix-wrap">
        <table className="plan2__matrix">
          <caption className="sr-only">Belegung der Techniker an den nächsten 7 Arbeitstagen, jede Zelle 07:00 bis 17:00</caption>
          <thead>
            <tr>
              <th scope="col">Techniker</th>
              {availability.days.map((day) => <th key={day} scope="col" className={day === today ? "is-today" : undefined}>{shortDay(day)}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.technicians.map((tech) => (
              <tr key={tech.id}>
                <th scope="row">{tech.name}</th>
                {availability.days.map((day) => {
                  const hours = hoursOn(data.workingHours, tech.id, day);
                  const blocks = availability.busy.filter((block) => block.technicianId === tech.id && dayKeyOf(new Date(block.start)) <= day && dayKeyOf(new Date(new Date(block.end).getTime() - 1)) >= day);
                  const absentAllDay = hours.length === 0 || blocks.some((block) => block.kind === "absence" && Date.parse(block.start) <= berlinToInstant(day, hours[0].start).getTime() && Date.parse(block.end) >= berlinToInstant(day, hours[hours.length - 1].end).getTime());
                  const window = absentAllDay ? null : earliestWindow({ ...input, days: [day] }, tech.id);
                  const segments = blocks.map((block) => {
                    const start = dayKeyOf(new Date(block.start)) < day ? 0 : minutesOfDay(new Date(block.start));
                    const end = dayKeyOf(new Date(block.end)) > day ? 24 * 60 : minutesOfDay(new Date(block.end));
                    return { kind: block.kind, start, end };
                  });
                  const chosen = pick && pick.technicianId === tech.id && pick.day === day;
                  const busyText = segments.filter((segment) => segment.kind === "visit").map((segment) => `${toTime(segment.start)}–${toTime(segment.end)}`).join(", ");
                  const aria = `${tech.name}, ${shortDay(day)}: ${absentAllDay ? "nicht verfügbar" : `${busyText ? `belegt ${busyText}` : "frei"}${window ? `, frei ab ${window.startTime}` : `, kein freies Fenster für ${duration / 60} h`}`}`;
                  const body = (
                    <span className="plan2__lane" aria-hidden="true">
                      {absentAllDay && <span className="plan2__seg plan2__seg--off" style={{ left: 0, width: "100%" }} />}
                      {!absentAllDay && day === today && <span className="plan2__seg plan2__seg--past" style={{ left: 0, width: pct(minutesOfDay(now)) }} />}
                      {!absentAllDay && segments.map((segment) => (
                        <span key={`${segment.start}-${segment.end}`} className={`plan2__seg plan2__seg--${segment.kind === "absence" ? "off" : "busy"}`} style={{ left: pct(segment.start), width: `calc(${pct(segment.end)} - ${pct(segment.start)})` }} />
                      ))}
                      {chosen && <span className="plan2__seg plan2__seg--pick" style={{ left: pct(toMinutes(pick.start)), width: `calc(${pct(toMinutes(pick.end))} - ${pct(toMinutes(pick.start))})` }} />}
                      {absentAllDay && <span className="plan2__off-label">nicht verfügbar</span>}
                    </span>
                  );
                  return (
                    <td key={day}>
                      {window && choose
                        ? <Link className="plan2__cell" href={choose(tech.id, day, window.startTime)} aria-label={`${aria}. Auswählen`} scroll={false}>{body}</Link>
                        : <span className="plan2__cell plan2__cell--disabled" role="img" aria-label={aria}>{body}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rw-card__note">Jede Zelle zeigt <span className="mono">07:00</span> bis <span className="mono">17:00</span>. {choose ? "Ein Klick übernimmt das früheste freie Fenster des Tages." : "Nach Auswahl einer Anfrage lassen sich freie Felder anklicken."}</p>
    </section>
  );
}
