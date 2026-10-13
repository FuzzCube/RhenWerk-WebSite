import Link from "next/link";
import { AgingBars } from "@/components/dashboard/aging-bars";
import { Card } from "@/components/dashboard/ui/card";
import { DeltaChip, InfoToggle, KpiCompact, KpiMore, KpiTile } from "@/components/dashboard/ui/kpi-tile";
import type { ExpandTile } from "@/components/dashboard/ui/expand-tiles";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { PriorityText } from "@/components/dashboard/ui/status-chip";
import { Icon } from "@/components/ui";
import { formatKpiChange, formatKpiValue, KPI_INFO, type KpiRow } from "@/lib/analytics";
import { addDays } from "@/lib/berlin-time";
import { invoiceDisplayStatus, overdueAging } from "@/lib/display-status";
import { ATTENTION_LABELS, type AttentionItem, type NowData, type Overview, type PlanningItem, type TeamNow, type TeamRow, type TechnicianDay } from "@/lib/dashboard/overview";
import { formatCalendarDate, formatCurrency, formatDateTime, formatElapsed, formatMinutes, formatNumber, formatTime, formatWeekdayDate } from "@/lib/format";
import { queuePeakHint, smallBaseHint } from "@/lib/hints";
import { label } from "@/lib/status";

// Blocks of the redesigned overview (task-10-3, canvas "Übersicht – Admin" and "– Manager").
// Zone 1 "Handlungsbedarf" is the current state and never filtered by the period.

const QUEUES = [
  { key: "analysis", step: 1, label: "In Analyse", note: "Automatische Analyse läuft", href: "/dashboard/anfragen?erstbearbeitung=analyzing" },
  { key: "review", step: 2, label: "Prüfung erforderlich", note: "Menschliche Prüfung nötig", href: "/dashboard/anfragen?erstbearbeitung=needs_review" },
  { key: "awaiting_customer", step: 3, label: "Wartet auf Kunde", note: "Rückfrage beim Kunden offen", href: "/dashboard/anfragen?erstbearbeitung=awaiting_customer" },
  { key: "planning", step: 4, label: "Einsatzplanung", note: "Bearbeitet, noch kein Einsatz", href: "/dashboard/planung" },
] as const;

const valueOn = (series: Array<{ day: string; value: number }>, day: string) => series.find((row) => row.day === day)?.value ?? 0;

function queueStats(now: NowData) {
  return QUEUES.map((queue) => {
    const series = now.queueHistory.filter((row) => row.queue === queue.key).map((row) => ({ day: row.day, value: Number(row.requests) }));
    return {
      ...queue,
      series,
      count: valueOn(series, now.today),
      yesterday: valueOn(series, addDays(now.today, -1)),
      monthAgoDay: addDays(now.today, -30),
      monthAgo: valueOn(series, addDays(now.today, -30)),
      peak: queuePeakHint(series, now.today),
    };
  });
}

const shortDate = (day: string) => formatCalendarDate(day).slice(0, 6);

// ---------- Zone 1: Handlungsbedarf ----------

export function HazardCard({ items, checkedAt }: { items: AttentionItem[]; checkedAt: string }) {
  const hazards = items.filter((item) => item.reason === "safety");
  const now = new Date(checkedAt).getTime();
  if (hazards.length === 0) {
    return (
      <Card stripe="success" title="Sicherheitsgefahr offen" count={0} id="hazards">
        <EmptyState tone="good" title="Keine offenen Sicherheitsgefahren">Stand <span className="mono">{formatDateTime(checkedAt)}</span>. Neue Fälle erscheinen hier sofort.</EmptyState>
      </Card>
    );
  }
  return (
    <Card
      stripe="danger"
      flush
      id="hazards"
      icon={<Icon name="hazard" size={22} />}
      title="Sicherheitsgefahr offen"
      count={hazards.length >= 50 ? "50+" : hazards.length}
      description="Kritische Fälle – müssen durch einen Menschen geprüft werden. Älteste zuerst."
      action={<Link className="rw-link-btn" href="/dashboard/anfragen?gefahr=1&status=offen">Alle ansehen<Icon name="chevron-right" size={16} /></Link>}
    >
      <table className="rw-table rw-table--stack rw-table--span2">
        <caption className="sr-only">Offene Anfragen mit Sicherheitsgefahr</caption>
        <thead><tr><th scope="col">Anfrage</th><th scope="col">Kunde</th><th scope="col">Offen seit</th><th scope="col">Gefahr</th></tr></thead>
        <tbody>
          {hazards.slice(0, 8).map((item) => {
            const minutes = (now - new Date(item.since).getTime()) / 60000;
            return (
              <tr key={item.requestId}>
                <td><Link className="mono" href={`/dashboard/anfragen/${item.requestId}`}>{item.requestNumber}</Link></td>
                <td>{item.company}</td>
                <td>
                  <span className={`mono${minutes > 24 * 60 ? " rw-text-danger" : ""}`}>{formatElapsed(minutes)}</span>
                  <span className="rw-sub mono">{formatDateTime(item.since)}</span>
                </td>
                <td><span className={`rw-priority ${item.detail === "unclear" ? "rw-priority--critical" : "rw-priority--high"}`}>{label("safety_risk", item.detail)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hazards.length > 8 && <p className="rw-card__footnote">Die 8 ältesten von {hazards.length} Fällen.</p>}
    </Card>
  );
}

// Compact hazard line for the manager page
export function HazardBanner({ items, checkedAt }: { items: AttentionItem[]; checkedAt: string }) {
  const hazards = items.filter((item) => item.reason === "safety");
  if (hazards.length === 0) {
    return (
      <div className="rw-banner rw-banner--good">
        <Icon name="check-circle" size={20} />
        <p><strong>Keine offenen Sicherheitsgefahren.</strong> Stand <span className="mono">{formatDateTime(checkedAt)}</span>.</p>
      </div>
    );
  }
  const oldest = hazards[0];
  const unclear = hazards.filter((item) => item.detail === "unclear").length;
  const minutes = (new Date(checkedAt).getTime() - new Date(oldest.since).getTime()) / 60000;
  return (
    <div className="rw-banner rw-banner--danger" role="region" aria-label="Sicherheitsgefahren">
      <Icon name="hazard" size={20} />
      <p>
        <strong>Sicherheitsgefahr offen: <span className="mono">{hazards.length >= 50 ? "50+" : hazards.length}</span></strong>
        {" · "}älteste seit <span className="mono">{formatElapsed(minutes)}</span> (<Link className="mono" href={`/dashboard/anfragen/${oldest.requestId}`}>{oldest.requestNumber}</Link>)
        {unclear > 0 && <>, {unclear === hazards.length ? "alle" : <><span className="mono">{unclear}</span> davon</>} mit Hinweis „Unklar“</>}
      </p>
      <Link className="rw-button-secondary" href="/dashboard/anfragen?gefahr=1&status=offen">Fälle ansehen</Link>
    </div>
  );
}

// Exceeded deadlines and long waits (former attention list without hazards and invoices)
const DEADLINE_REASONS = ["response_overdue", "service_overdue", "review_waiting", "parts_waiting"] as const;

export function DeadlinesCard({ items, checkedAt }: { items: AttentionItem[]; checkedAt: string }) {
  const due = items.filter((item) => (DEADLINE_REASONS as readonly string[]).includes(item.reason));
  if (due.length === 0) {
    return (
      <Card stripe="success" title="Fristen und Wartezeiten" id="deadlines">
        <EmptyState tone="good" title="Keine überschrittenen Fristen">Antwort- und Servicefristen sind eingehalten, nichts wartet ungewöhnlich lange.</EmptyState>
      </Card>
    );
  }
  const now = new Date(checkedAt).getTime();
  return (
    <Card stripe="attention" flush className="rw-card--list" id="deadlines" title="Fristen und Wartezeiten" count={due.length >= 50 ? "50+" : due.length} description="Dringendste zuerst">
      {/* A list instead of a table: fits the narrow column next to the planning queue */}
      <ul className="rw-deadlines" aria-label="Überschrittene Fristen und lange Wartezeiten">
        {due.slice(0, 6).map((item) => (
          <li key={`${item.reason}-${item.requestId}`}>
            <Link className="rw-deadline" href={`/dashboard/anfragen/${item.requestId}`}>
              <span className="rw-deadline__top">
                <strong>{ATTENTION_LABELS[item.reason]}</strong>
                <span className="rw-deadline__age mono">{formatElapsed((now - new Date(item.since).getTime()) / 60000)}</span>
              </span>
              <span className="rw-deadline__sub"><span className="mono">{item.requestNumber}</span> · {item.company}</span>
              <span className="rw-deadline__since">seit <span className="mono">{formatDateTime(item.since)}</span></span>
            </Link>
          </li>
        ))}
      </ul>
      {due.length > 6 && <p className="rw-card__footnote">Die 6 dringendsten von {due.length} Einträgen.</p>}
    </Card>
  );
}

export function QueuesCard({ now }: { now: NowData }) {
  const stats = queueStats(now);
  const max = Math.max(1, ...stats.map((queue) => queue.count));
  const peaks = stats.filter((queue) => queue.peak);
  return (
    <Card
      stripe={peaks.length ? "attention" : "neutral"}
      id="queues"
      title="Warteschlangen"
      action={<span className="rw-card__aside"><span className="mono">{formatNumber(now.openRequests)}</span> offen gesamt</span>}
    >
      <ul className="rw-bars">
        {[...stats].sort((a, b) => b.count - a.count || a.step - b.step).map((queue) => (
          <li key={queue.key}>
            <Link href={queue.href}>
              <span className="rw-bars__label">{queue.label}{queue.peak && <span className="rw-flag">Engpass</span>}</span>
              <span className="mono rw-bars__value">{queue.count}</span>
              <span className="rw-bars__track" aria-hidden="true"><span style={{ width: `${(queue.count / max) * 100}%` }} /></span>
            </Link>
          </li>
        ))}
      </ul>
      {peaks.length > 0 && (
        // One explanation for all flagged queues instead of a paragraph per queue
        <p className="rw-card__note">
          Engpass: {peaks[0].peak!.text}. Zum Vergleich am {shortDate(peaks[0].monthAgoDay)}:{" "}
          {peaks.map((queue, index) => (
            <span key={queue.key}>{index > 0 && ", "}{queue.label} <span className="mono">{queue.monthAgo}</span></span>
          ))}.
        </p>
      )}
    </Card>
  );
}

// Details of the tile "Überfällige Forderungen": the same figures as on the invoice page (age buckets) and
// the oldest overdue invoices, each linked to its request
export function OverdueCard({ now }: { now: NowData }) {
  const { overdue } = now;
  if (overdue.count === 0) {
    return (
      <Card stripe="success" title="Überfällige Forderungen" id="overdue">
        <EmptyState tone="good" title="Keine überfälligen Forderungen">Alle offenen Rechnungen liegen innerhalb der Zahlungsfrist.</EmptyState>
      </Card>
    );
  }
  const shown = overdue.invoices.slice(0, 8);
  return (
    <Card
      stripe="attention"
      id="overdue"
      icon={<Icon name="clock" size={20} />}
      title="Überfällige Forderungen"
      count={overdue.count}
      description={<><span className="mono">{formatCurrency(overdue.total)}</span> brutto · älteste fällig seit <span className="mono">{formatCalendarDate(overdue.oldestDue)}</span>. Ausgestellt ist nicht eingenommen.</>}
      action={<Link className="rw-link-btn" href="/dashboard/rechnungen?status=ueberfaellig">Alle überfälligen ansehen<Icon name="chevron-right" size={16} /></Link>}
    >
      <div className="rw-overdue">
        <section aria-labelledby="overdue-aging">
          <h4 id="overdue-aging" className="rw-subhead">Überfällig nach Alter</h4>
          <AgingBars buckets={overdueAging(overdue.invoices.map((row) => ({ status: row.status, payment_due_date: row.dueDate, total: row.total })), now.today)} />
        </section>
        <section aria-labelledby="overdue-oldest">
          <h4 id="overdue-oldest" className="rw-subhead">Älteste überfällige Rechnungen</h4>
          <table className="rw-table rw-table--stack rw-table--lead">
            <caption className="sr-only">Älteste überfällige Rechnungen</caption>
            <thead><tr><th scope="col">Rechnung</th><th scope="col">Überfällig</th><th scope="col" className="rw-num">Brutto</th></tr></thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <td><Link className="mono" href={`/dashboard/anfragen/${row.requestId}#rechnung`}>{row.invoiceNumber ?? row.requestNumber}</Link><span className="rw-sub">{row.company}</span></td>
                  <td><span className="mono rw-text-danger">{formatNumber(invoiceDisplayStatus(row.status, row.dueDate, now.today).overdueDays ?? 0)} Tage</span><span className="rw-sub mono">fällig {formatCalendarDate(row.dueDate)}</span></td>
                  <td className="rw-num mono">{formatCurrency(row.total, row.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {overdue.count > shown.length && <p className="rw-card__note">Die {shown.length} ältesten von {formatNumber(overdue.count)} Rechnungen.</p>}
        </section>
      </div>
    </Card>
  );
}

// Summary tiles of "Handlungsbedarf" (admin): one figure each, the cards above become the details.
// A source that failed to load marks its tiles; the other tiles stay usable.
export function handlungsbedarfTiles(attention: Overview["attention"] | null, now: NowData | null): ExpandTile[] {
  const failed = (title: string): Pick<ExpandTile, "stripe" | "value" | "note" | "panel"> => ({
    stripe: "danger",
    value: "–",
    note: "Konnte nicht geladen werden",
    panel: (
      <Card stripe="danger" title={title}>
        <ErrorState title={`${title}: Daten konnten nicht geladen werden.`} action={<Link className="rw-button-secondary" href="/dashboard/uebersicht">Erneut versuchen</Link>}>Die übrigen Bereiche der Seite sind aktuell.</ErrorState>
      </Card>
    ),
  });
  const count = (value: number) => (value >= 50 ? "50+" : formatNumber(value));
  const tiles: ExpandTile[] = [];

  if (attention) {
    const checked = new Date(attention.checkedAt).getTime();
    const elapsed = (since: string) => formatElapsed((checked - new Date(since).getTime()) / 60000);
    const hazards = attention.items.filter((item) => item.reason === "safety");
    const due = attention.items.filter((item) => (DEADLINE_REASONS as readonly string[]).includes(item.reason));
    tiles.push(
      {
        key: "gefahr",
        label: "Sicherheitsgefahr offen",
        stripe: hazards.length ? "danger" : "success",
        value: count(hazards.length),
        note: hazards.length ? <>älteste seit <span className="mono">{elapsed(hazards[0].since)}</span></> : "Keine offenen Fälle",
        panel: <HazardCard items={attention.items} checkedAt={attention.checkedAt} />,
      },
      {
        key: "fristen",
        label: "Fristen und Wartezeiten",
        stripe: due.length ? "attention" : "success",
        value: count(due.length),
        note: due.length ? <>dringendste seit <span className="mono">{elapsed(due[0].since)}</span></> : "Alle Fristen eingehalten",
        panel: <DeadlinesCard items={attention.items} checkedAt={attention.checkedAt} />,
      },
    );
  } else {
    tiles.push({ key: "gefahr", label: "Sicherheitsgefahr offen", ...failed("Sicherheitsgefahren") }, { key: "fristen", label: "Fristen und Wartezeiten", ...failed("Fristen und Wartezeiten") });
  }

  if (now) {
    const stats = queueStats(now);
    const peak = stats.filter((queue) => queue.peak).sort((a, b) => b.count - a.count)[0];
    const biggest = peak ?? [...stats].sort((a, b) => b.count - a.count)[0];
    tiles.push(
      {
        key: "warteschlangen",
        label: "Warteschlangen",
        stripe: peak ? "attention" : "neutral",
        value: <>{formatNumber(now.openRequests)}<span className="rw-tile__unit"> offen</span></>,
        note: biggest.count ? <>{peak ? "Engpass" : "größte"}: {biggest.label} <span className="mono">{biggest.count}</span></> : "Keine Anfragen in Warteschlangen",
        panel: <QueuesCard now={now} />,
      },
      {
        key: "forderungen",
        label: "Überfällige Forderungen",
        stripe: now.overdue.count ? "attention" : "success",
        value: formatCurrency(now.overdue.total),
        note: now.overdue.count ? <><span className="mono">{formatNumber(now.overdue.count)}</span> {now.overdue.count === 1 ? "Rechnung" : "Rechnungen"} · seit <span className="mono">{formatCalendarDate(now.overdue.oldestDue)}</span></> : "Keine überfälligen Rechnungen",
        panel: <OverdueCard now={now} />,
      },
    );
  } else {
    tiles.push({ key: "warteschlangen", label: "Warteschlangen", ...failed("Warteschlangen") }, { key: "forderungen", label: "Überfällige Forderungen", ...failed("Überfällige Forderungen") });
  }
  return tiles;
}

// Manager: four queue steps with a 14-day history each (small multiples instead of one chart)
export function QueueStages({ now }: { now: NowData }) {
  const stats = queueStats(now);
  const days = Array.from({ length: 14 }, (_, index) => addDays(now.today, index - 13));
  const max = Math.max(1, ...stats.flatMap((queue) => days.map((day) => valueOn(queue.series, day))));
  return (
    <ul className="rw-stages">
      {stats.map((queue) => {
        const values = days.map((day) => valueOn(queue.series, day));
        return (
          <li key={queue.key} className={`rw-card ${queue.peak ? "rw-card--attention" : "rw-card--neutral"} rw-stage`}>
            <p className="rw-stage__step">Schritt {queue.step}{queue.peak && <span className="rw-flag">Engpass</span>}</p>
            <h3 className="rw-stage__label"><Link href={queue.href}>{queue.label}</Link></h3>
            <p className="rw-stage__count mono">{queue.count}</p>
            <span className="rw-spark" role="img" aria-label={`Verlauf 14 Tage: ${days.map((day, index) => `${shortDate(day)} ${values[index]}`).join(", ")}`}>
              {values.map((value, index) => (
                <span key={days[index]} title={`${shortDate(days[index])}: ${value}`} className={value === 0 ? "rw-spark__zero" : index === values.length - 1 ? "rw-spark__last" : undefined} style={{ height: `${Math.max(2, Math.round((value / max) * 32))}px` }} />
              ))}
            </span>
            <p className="rw-card__note">{queue.peak ? `${queue.peak.text} · ` : ""}Gestern <span className="mono">{queue.yesterday}</span> · am {shortDate(queue.monthAgoDay)} <span className="mono">{queue.monthAgo}</span></p>
            <p className="rw-card__note">{queue.note}</p>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Zone 2: Leistung im Zeitraum ----------

const MAIN_KPIS = ["received", "completed", "lead_time_days", "response_on_time"];
const MORE_KPIS = ["intake_completed", "automatic_share", "service_on_time", "time_saved_minutes", "open_requests", "review_queue", "planning_queue"];

function kpiHint(row: KpiRow): string | null {
  const detail = row.detail ?? {};
  if (row.unit === "percent" && detail.total !== undefined) return smallBaseHint(Number(detail.total))?.text ?? null;
  if (row.key === "time_saved_minutes" && detail.requests !== undefined) return `${formatNumber(Number(detail.requests))} Anfragen × Basiswert ${formatMinutes(Number(detail.baseline_max ?? 0))}`;
  return null;
}

export function PerformanceKpis({ data }: { data: Overview }) {
  const byKey = new Map(data.kpis.map((row) => [row.key, row]));
  const tile = (key: string, compact = false) => {
    const row = byKey.get(key);
    if (!row) return null;
    const props = {
      label: row.label,
      value: formatKpiValue(row.unit, row.current_value),
      previous: formatKpiValue(row.unit, row.previous_value),
      change: formatKpiChange(row),
      definition: KPI_INFO[row.key]?.definition,
      href: KPI_INFO[row.key]?.href?.(data.window),
      hint: kpiHint(row),
      kpiKey: row.key,
      rawValue: row.current_value,
    };
    return compact ? <KpiCompact key={key} {...props} /> : <KpiTile key={key} {...props} />;
  };
  const more = MORE_KPIS.filter((key) => byKey.has(key));
  return (
    <>
      <div className="rw-kpi-grid" data-kpis="main">{MAIN_KPIS.map((key) => tile(key))}</div>
      {more.length > 0 && <KpiMore count={more.length}>{more.map((key) => tile(key, true))}</KpiMore>}
    </>
  );
}

// ---------- Zone 3: Details ----------

const FINANCE = [
  { key: "invoiced_gross", kind: "Im Zeitraum" },
  { key: "payments_received", kind: "Im Zeitraum" },
  { key: "revenue_net", kind: "Im Zeitraum" },
  { key: "open_receivables", kind: "Stand Ende des Zeitraums" },
  { key: "overdue_receivables", kind: "Stand Ende des Zeitraums" },
];

export function FinanceCard({ data }: { data: Overview }) {
  const byKey = new Map(data.kpis.map((row) => [row.key, row]));
  return (
    <Card stripe="meta" id="finance-list">
      <ul className="rw-rows">
        {FINANCE.map(({ key, kind }) => {
          const row = byKey.get(key);
          if (!row) return null;
          const href = KPI_INFO[key]?.href?.(data.window);
          return (
            <li key={key} data-kpi={key} data-value={row.current_value ?? ""}>
              <span className="rw-rows__label">
                {href ? <Link className="rw-kpi__link" href={href}>{row.label}</Link> : row.label}
                <span className="rw-sub">{kind}</span>
              </span>
              <span className="rw-rows__value">
                <span className="mono">{formatKpiValue(row.unit, row.current_value)}</span>
                <DeltaChip change={formatKpiChange(row)} />
              </span>
              {KPI_INFO[key] && <InfoToggle label={row.label}>{KPI_INFO[key].definition}</InfoToggle>}
            </li>
          );
        })}
      </ul>
      <p className="rw-card__note"><strong>Ausgestellt ist nicht eingenommen.</strong> Musterrechnungen mit Demodaten.</p>
    </Card>
  );
}

const plural = (count: number, one: string, many: string) => `${formatNumber(count)} ${count === 1 ? one : many}`;

// Deactivated employees with activity in the period are hidden by default (toggle via ?status=alle);
// the footnote names how many are hidden so the team figures still add up.
export function TeamTable({ rows: all, idle, showInactive = false, toggleHref }: { rows: TeamRow[]; idle: number; showInactive?: boolean; toggleHref?: string }) {
  const inactive = all.filter((row) => !row.is_active).length;
  const rows = showInactive ? all : all.filter((row) => row.is_active);
  const toggle = inactive > 0 && toggleHref && (
    <p className="rw-card__footnote">
      {showInactive
        ? <>Einschließlich {plural(inactive, "deaktivierter Person", "deaktivierter Mitarbeitender")}. <Link href={toggleHref} scroll={false}>Deaktivierte ausblenden</Link></>
        : <>{plural(inactive, "deaktivierte Person", "deaktivierte Mitarbeitende")} mit Tätigkeit im Zeitraum ausgeblendet. <Link href={toggleHref} scroll={false}>Anzeigen</Link></>}
    </p>
  );
  if (rows.length === 0) {
    return <Card stripe="meta"><EmptyState title="Keine Tätigkeit im Zeitraum">Niemand hat im gewählten Zeitraum Anfragen bearbeitet oder offen zugewiesen.</EmptyState>{toggle}</Card>;
  }
  const max = Math.max(1, ...rows.map((row) => row.open_requests));
  return (
    <Card stripe="meta" flush className="rw-card--fill">
      <table className="rw-table">
        <caption className="sr-only">Team: Tätigkeit im Zeitraum und offen zugewiesene Anfragen</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Rolle</th><th scope="col">Im Zeitraum</th><th scope="col">Arbeitszeit</th><th scope="col">Offen zugewiesen</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.employee_id}>
              <td><strong>{row.display_name}</strong>{!row.is_active && <span className="rw-sub">Deaktiviert</span>}</td>
              <td className="rw-muted">{row.role === "dispatcher" ? "Dispatcher" : "Techniker"}</td>
              <td>{row.role === "dispatcher" ? plural(row.intake_completed, "Erstbearbeitung", "Erstbearbeitungen") : plural(row.visits_completed, "Einsatz", "Einsätze")}</td>
              <td className="mono">{row.role === "technician" ? formatMinutes(row.work_minutes) : "–"}</td>
              <td><span className="rw-bar-cell"><span className="mono">{row.open_requests}</span><span className="rw-bars__track rw-bars__track--meta" aria-hidden="true"><span style={{ width: `${(row.open_requests / max) * 100}%` }} /></span></span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {idle > 0 && <p className="rw-card__footnote">{plural(idle, "weitere aktive Person", "weitere aktive Mitarbeitende")} ohne Tätigkeit und ohne offene Anfragen im Zeitraum.</p>}
      {toggle}
    </Card>
  );
}

// ---------- Manager: team now and requests to plan ----------

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function ServiceDeskCard({ team }: { team: TeamNow }) {
  const desk = team.month.filter((row) => row.role === "dispatcher" && row.is_active).sort((a, b) => b.open_requests - a.open_requests || a.display_name.localeCompare(b.display_name, "de"));
  const month = MONTHS[Number(team.monthStart.slice(5, 7)) - 1];
  const max = Math.max(1, ...desk.map((row) => row.open_requests));
  return (
    <Card stripe="meta" flush className="rw-card--list" title="Service Desk" description="Offen zugewiesen je Person">
      {desk.length === 0 ? <div className="rw-card--list__pad"><EmptyState title="Keine aktiven Dispatcher" /></div> : (
        <div className="rw-card--list__pad">
          <ul className="rw-bars">
            {desk.map((row) => (
              <li key={row.employee_id}>
                <span className="rw-bars__row">
                  <span>{row.display_name}</span>
                  <span className="mono rw-bars__value">{row.open_requests}</span>
                  <span className="rw-bars__track" aria-hidden="true"><span style={{ width: `${(row.open_requests / max) * 100}%` }} /></span>
                </span>
              </li>
            ))}
          </ul>
          <p className="rw-card__note">
            Erstbearbeitungen im {month}:{" "}
            {[...desk].sort((a, b) => b.intake_completed - a.intake_completed).map((row, index, all) => (
              <span key={row.employee_id}>{row.display_name} <span className="mono">{row.intake_completed}</span>{index < all.length - 1 ? ", " : "."}</span>
            ))}
          </p>
        </div>
      )}
    </Card>
  );
}

function DayCell({ day }: { day: TechnicianDay }) {
  if (day.visits.length > 0) {
    return (
      <span className="rw-day-cells">
        {day.visits.map((visit) => (
          <Link key={`${visit.requestId}-${visit.start}`} className="rw-day-cell rw-day-cell--job" href={`/dashboard/anfragen/${visit.requestId}`}>
            <span className="mono">{visit.requestNumber}</span>
            <span className="rw-sub mono">{formatTime(visit.start)}–{formatTime(visit.end)}</span>
          </Link>
        ))}
      </span>
    );
  }
  if (day.absent) return <span className="rw-day-cell rw-day-cell--off">Nicht verfügbar</span>;
  return <span className="rw-day-cell rw-day-cell--free">Keine Einsätze geplant</span>;
}

export function TechniciansCard({ team, today }: { team: TeamNow; today: string }) {
  const month = MONTHS[Number(team.monthStart.slice(5, 7)) - 1];
  return (
    <Card
      stripe="meta"
      flush
      className="rw-card--list"
      title="Techniker"
      description="Belegung heute und morgen"
      action={<Link className="rw-link-btn" href="/dashboard/planung">Wochenplan öffnen<Icon name="chevron-right" size={16} /></Link>}
    >
      {team.technicians.length === 0 ? <div className="rw-card__pad"><EmptyState title="Keine aktiven Techniker" /></div> : (
        <table className="rw-table">
          <caption className="sr-only">Techniker: Einsätze heute und morgen, Tätigkeit im {month}</caption>
          <thead><tr>
            <th scope="col">Name</th>
            <th scope="col">Heute, {formatWeekdayDate(`${today}T12:00:00Z`).replace(/\d{4}$/, "")}</th>
            <th scope="col">Morgen, {formatWeekdayDate(`${team.tomorrow}T12:00:00Z`).replace(/\d{4}$/, "")}</th>
            <th scope="col">Einsätze {month.slice(0, 3)}.</th>
            <th scope="col" className="rw-num">Offen</th>
          </tr></thead>
          <tbody>
            {team.technicians.map((tech) => (
              <tr key={tech.id}>
                <td><strong>{tech.name}</strong></td>
                <td><DayCell day={tech.today} /></td>
                <td><DayCell day={tech.tomorrow} /></td>
                <td><span className="mono">{tech.visitsCompleted}</span> · <span className="mono">{formatMinutes(tech.workMinutes)}</span></td>
                <td className="rw-num mono">{tech.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

const PLAN_NOTES: Record<NonNullable<PlanningItem["note"]>, string> = { follow_up: "Folgeeinsatz", waiting_parts: "Wartet auf Teile" };

export function ToPlanCard({ items, limit = 8 }: { items: PlanningItem[]; limit?: number }) {
  if (items.length === 0) {
    return (
      <Card stripe="success" headingLevel={2} id="to-plan" title="Zu planen" count={0}>
        <EmptyState tone="good" title="Alle Anfragen sind eingeplant">Neue bearbeitete Anfragen erscheinen hier, sobald sie einen Einsatz brauchen.</EmptyState>
      </Card>
    );
  }
  return (
    <Card
      stripe="action"
      flush
      className="rw-card--list"
      headingLevel={2}
      id="to-plan"
      title="Zu planen"
      count={items.length}
      description="Sortiert nach Priorität, dann nach Frist und Wartezeit."
      action={<Link className="button button--primary" href="/dashboard/planung">Einsätze planen</Link>}
    >
      <table className="rw-table">
        <caption className="sr-only">Anfragen ohne geplanten Einsatz</caption>
        <thead><tr><th scope="col">Anfrage</th><th scope="col">Kunde</th><th scope="col">Leistung</th><th scope="col">Priorität</th><th scope="col">Hinweis</th></tr></thead>
        <tbody>
          {items.slice(0, limit).map((item) => (
            <tr key={item.id}>
              <td><Link className="mono" href={`/dashboard/planung?anfrage=${item.id}`}>{item.requestNumber}</Link></td>
              <td><strong>{item.company}</strong>{item.city && <span className="rw-sub">{item.city}</span>}</td>
              <td>{label("service_kind", item.serviceKind)}</td>
              <td><PriorityText priority={item.priority} /></td>
              <td className={item.note ? undefined : "rw-muted"}>{item.note ? PLAN_NOTES[item.note] : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > limit && <p className="rw-card__footnote">Die {limit} dringendsten von {items.length} Anfragen · <Link href="/dashboard/planung">Alle {items.length} in der Einsatzplanung</Link></p>}
    </Card>
  );
}
