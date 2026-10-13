import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense, type ReactNode } from "react";
import { TimeChart, type ChartFormat, type ChartSeries } from "@/components/dashboard/charts";
import { PeriodControl } from "@/components/dashboard/period-bar";
import { Card } from "@/components/dashboard/ui/card";
import { Legend, PeriodChip } from "@/components/dashboard/ui/legend";
import { SideMenu } from "@/components/dashboard/ui/side-menu";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/dashboard/ui/states";
import { monthRecordHint, queuePeakHint, smallBaseHint } from "@/lib/hints";
import { parsePeriodParams, PERIOD_OPTIONS, periodTitle, type PeriodParams } from "@/lib/analytics";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { CHART_COLORS } from "@/lib/chart-colors";
import { getInsights, type Insights } from "@/lib/dashboard/insights";
import { formatCurrency, formatMinutes, formatNumber, formatPercent } from "@/lib/format";
import { automationSeries, cumulativeComparison, monthLabel, QUEUE_LABELS, queueSeries, seasonality, sum } from "@/lib/insights";
import { label, statusInfo } from "@/lib/status";

export const metadata: Metadata = { title: "Auswertung" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Areas in the side menu (?bereich=…); only the selected area is rendered. "Auf einen Blick" stays above every area.
const AREAS = [
  { key: "durchsatz", label: "Durchsatz", group: "Betrieb", description: "Eingang, Erstbearbeitung und Abschluss über die Zeit, verglichen mit dem Vorzeitraum." },
  { key: "warteschlangen", label: "Warteschlangen", group: "Betrieb", description: "Anfragen je Warteschlange am Tagesende, rekonstruiert aus dem Verlauf." },
  { key: "finanzen", label: "Finanzen", group: "Geschäft", description: "Ausgestellt ist nicht eingenommen. Musterrechnungen mit Demodaten." },
  { key: "automatisierung", label: "Automatisierung", group: "Geschäft", description: "Anteil automatischer Erstbearbeitung, geschätzte Zeitersparnis und Läufe im Zeitraum." },
] as const;
const GROUPS = ["Betrieb", "Geschäft"] as const;
type Area = (typeof AREAS)[number]["key"];

const BASE = "/dashboard/auswertung";

function parseArea(value: string | string[] | undefined): Area {
  const single = Array.isArray(value) ? value[0] : value;
  return AREAS.find((area) => area.key === single)?.key ?? "durchsatz";
}

// Link to an area that keeps the chosen period; default values stay out of the URL
function areaHref(area: Area, period: PeriodParams) {
  const params = new URLSearchParams();
  if (area !== "durchsatz") params.set("bereich", area);
  if (period.param !== PERIOD_OPTIONS[1].param || period.anchor) params.set("zeitraum", period.param);
  if (period.anchor) params.set("datum", period.anchor);
  const query = params.toString();
  return query ? `${BASE}?${query}` : BASE;
}

// Charts and automation area (task-7-3, tabs since task-10-3). Every chart reads database data through the
// analytics functions; each figure has a text summary, a legend for two or more series and a data table.
export default async function InsightsPage({ searchParams }: Props) {
  await requireRole(rolesFor("/dashboard/auswertung"));
  const params = await searchParams;
  const period = parsePeriodParams(params);
  const area = parseArea(params.bereich);
  const current = AREAS.find((entry) => entry.key === area)!;
  return (
    <div className="dash-page rw-page rw-page--tight side-page insights">
      <header className="side-page__head">
        <div className="side-page__head-text">
          <h1 id="area-title" className="side-page__title">{current.label}</h1>
          <p className="side-page__desc">{current.description}</p>
        </div>
        {(area === "durchsatz" || area === "automatisierung") && (
          <div className="insights__period">
            <span>{area === "durchsatz" ? "Vergleichszeitraum" : "Zeitraum der Läufe"}</span>
            {/* The window comes with the data; the control itself only needs its bounds, loaded in the content */}
            <Suspense fallback={null}><PeriodSlot period={period} area={area} /></Suspense>
          </div>
        )}
      </header>

      <div className="side-page__grid">
        <SideMenu
          label="Bereiche"
          title="Auswertung"
          scope={["Langfristige Entwicklung aus den Datenbankdaten.", "Jedes Diagramm nennt seinen eigenen Zeitraum."]}
          groups={GROUPS.map((group) => ({
            title: group,
            items: AREAS.filter((entry) => entry.group === group).map((entry) => ({ key: entry.key, label: entry.label, href: areaHref(entry.key, period), active: entry.key === area })),
          }))}
        />
        <section className="side-page__main" aria-labelledby="area-title">
          <Suspense key={`${area}-${period.param}-${period.anchor ?? ""}`} fallback={<div className="insights-grid">{[1, 2, 3, 4].map((index) => <Card key={index} busy><LoadingState shape="chart" label="Diagramme werden geladen …" /></Card>)}</div>}>
            <InsightsContent period={period} area={area} />
          </Suspense>
        </section>
      </div>
    </div>
  );
}

// One database read per request for the head (period control) and the content
const loadInsights = cache((key: string) => getInsights(JSON.parse(key) as PeriodParams));
const insightsFor = (period: PeriodParams) => loadInsights(JSON.stringify({ kind: period.kind, param: period.param, anchor: period.anchor }));

async function PeriodSlot({ period, area }: { period: PeriodParams; area: Area }) {
  const data = await insightsFor(period).catch(() => null);
  if (!data) return null;
  return <PeriodControl basePath={BASE} period={period} window={data.window} extraQuery={area === "automatisierung" ? "&bereich=automatisierung" : ""} />;
}

const slot = (index: number) => CHART_COLORS[index];

async function InsightsContent({ period, area }: { period: PeriodParams; area: Area }) {
  let data: Insights;
  try {
    data = await insightsFor(period);
  } catch {
    return <ErrorState title="Die Auswertung konnte nicht geladen werden." action={<Link className="rw-button-secondary" href={areaHref(area, period)}>Erneut versuchen</Link>}>Kennzahlen der Übersicht sind davon nicht betroffen.</ErrorState>;
  }
  const { window: w } = data;
  const months = data.months.map((row) => ({ ...row, month: monthLabel(row.bucket_start) }));
  const last12 = months.slice(-12);

  // 1 Flow: received, initial processing completed, completed (separate series by their own timestamps)
  const flowSeries: ChartSeries[] = [
    { key: "received", label: "Eingang", color: slot(0) },
    { key: "intake_completed", label: "Erstbearbeitung abgeschlossen", color: slot(1) },
    { key: "completed", label: "Technisch abgeschlossen", color: slot(2) },
  ];

  // 2 Comparison: cumulative received per day
  const comparison = cumulativeComparison(
    data.currentDays.map((row) => ({ bucket_start: row.bucket_start, value: row.received })),
    data.previousDays.map((row) => ({ bucket_start: row.bucket_start, value: row.received })),
  ).map((row) => ({ ...row, label: `Tag ${row.day}` }));
  const comparisonSeries: ChartSeries[] = [
    { key: "current", label: periodTitle(period.kind, w.startDay), color: slot(0) },
    { key: "previous", label: "Vorzeitraum", color: slot(1) },
  ];
  const elapsed = data.currentDays.length;
  const currentTotal = sum(data.currentDays.map((row) => row.received));
  const previousSame = sum(data.previousDays.slice(0, elapsed).map((row) => row.received));

  // 3 Seasonality: received per calendar month and year (at most three years)
  const season = seasonality(data.seasonalMonths, data.today);
  const seasonSeries: ChartSeries[] = season.years.slice(-3).map((year, index) => ({ key: year, label: year, color: slot(index) }));

  // 4 Queues at the end of each day
  const queues = queueSeries(data.queues);
  const queueKeys = ["analysis", "review", "awaiting_customer", "planning"];

  // 5 Finance: issued and paid per month (issued is not collected)
  const financeSeries: ChartSeries[] = [
    { key: "invoiced_gross", label: "Ausgestellt (brutto)", color: slot(0) },
    { key: "payments_received", label: "Zahlungseingang (brutto)", color: slot(1) },
  ];

  // 6 Automation
  const automation = automationSeries(data.months);
  const savedTotal = sum(automation.map((row) => row.savedMinutes));
  const savedRequests = sum(automation.map((row) => row.savedRequests));
  const runs = data.automation;
  const runTotals = { all: sum(runs.map((row) => row.runs)), failed: sum(runs.filter((row) => row.status === "failed").map((row) => row.runs)), corrected: sum(runs.map((row) => row.corrected)) };

  const table = <Row extends Record<string, unknown>>(rows: Row[], xKey: keyof Row, xLabel: string, series: ChartSeries[], format: ChartFormat | "mixed") => {
    const columns: Column<Row>[] = [
      { key: "x", header: xLabel, cell: (row) => String(row[xKey]), mobile: "title" },
      ...series.map((entry) => ({ key: entry.key, header: entry.label, cell: (row: Row) => tableValue(format, row[entry.key]), align: "end" as const })),
    ];
    return <DataTable caption={xLabel} columns={columns} rows={rows} rowKey={(row) => String(row[xKey])} empty={<EmptyState title="Keine Daten." />} />;
  };

  // "Auf einen Blick": generated by the fixed hint rules (lib/hints.ts), never maintained by hand
  const today = data.today;
  const queueStats = queueKeys.map((key) => {
    const history = data.queues.filter((row) => row.queue === key).map((row) => ({ day: row.day, value: Number(row.requests) }));
    return { key, label: QUEUE_LABELS[key], history, today: history.find((row) => row.day === today)?.value ?? 0, max: Math.max(0, ...history.map((row) => row.value)), peak: queuePeakHint(history, today) };
  });
  const peakQueue = queueStats.find((queue) => queue.peak);
  const biggestQueue = [...queueStats].sort((a, b) => b.today - a.today)[0];
  const completedMonths = months.filter((row) => row.bucket_start.slice(0, 7) < today.slice(0, 7));
  const lastMonth = completedMonths.at(-1);
  const record = monthRecordHint(months.map((row) => ({ bucket_start: row.bucket_start, value: row.received })), `${today.slice(0, 7)}-01`);
  const shareNow = automation.at(-1);
  const issued12 = sum(last12.map((row) => row.invoiced_gross));
  const paid12 = sum(last12.map((row) => row.payments_received));
  const glance = [
    peakQueue
      ? { key: "warteschlangen", area: "Warteschlangen", value: formatNumber(peakQueue.today), text: `in „${peakQueue.label}“ – ${peakQueue.peak!.text}.`, href: areaHref("warteschlangen", period), warn: true }
      : { key: "warteschlangen", area: "Warteschlangen", value: formatNumber(biggestQueue.today), text: `in „${biggestQueue.label}“, größte Warteschlange heute; kein Höchststand.`, href: areaHref("warteschlangen", period), warn: false },
    lastMonth && { key: "durchsatz", area: "Durchsatz", value: formatNumber(lastMonth.received), text: `Eingänge im ${lastMonth.month}${record ? ` – ${record.text}` : ""}.`, href: areaHref("durchsatz", period), warn: false },
    shareNow && shareNow.share !== null && { key: "automatisierung", area: "Automatisierung", value: formatPercent(shareNow.share), text: `automatisch im ${shareNow.month}${smallBaseHint(shareNow.total) ? ` – ${smallBaseHint(shareNow.total)!.text}, Wert schwankt noch` : ""}.`, href: areaHref("automatisierung", period), warn: false },
    { key: "finanzen", area: "Finanzen", value: formatCurrency(Math.abs(issued12 - paid12)), text: `${issued12 >= paid12 ? "mehr ausgestellt als eingegangen" : "mehr eingegangen als ausgestellt"} in den letzten 12 Monaten.`, href: areaHref("finanzen", period), warn: false },
  ].filter((item): item is { key: Area; area: string; value: string; text: string; href: string; warn: boolean } => Boolean(item))
    .sort((a, b) => AREAS.findIndex((entry) => entry.key === a.key) - AREAS.findIndex((entry) => entry.key === b.key));
  const running = `${monthLabel(`${today.slice(0, 7)}-01`)} läuft noch (gestrichelt).`;
  const legend = (series: ChartSeries[]) => <Legend items={series.map((entry) => ({ label: entry.label, color: entry.color }))} />;

  const last12Note = `Letzte 12 Monate: ${formatNumber(sum(last12.map((row) => row.received)))} Eingänge, ${formatNumber(sum(last12.map((row) => row.intake_completed)))} Erstbearbeitungen, ${formatNumber(sum(last12.map((row) => row.completed)))} technische Abschlüsse.`;

  return (
    <>
      <section aria-labelledby="glance">
        <h2 id="glance" className="sr-only">Auf einen Blick</h2>
        <div className="insights-grid insights-grid--glance">
          {glance.map((item) => (
            <Link key={item.area} href={item.href} scroll={false} aria-current={item.key === area ? "page" : undefined} className={`rw-card ${item.warn ? "rw-card--attention" : "rw-card--neutral"} rw-glance`}>
              <span className="rw-stage__step">{item.area}</span>
              <span className="rw-glance__value mono">{item.value}</span>
              <span className="rw-card__note">{item.text}</span>
            </Link>
          ))}
        </div>
      </section>

      {area === "durchsatz" && <div className="insights-grid">
        <Figure className="insights-grid__full" id="flow-chart" title="Eingang, Erstbearbeitung und Abschluss je Monat" chip="24 Monate" summary={`${last12Note} Jede Reihe zählt nach ihrem eigenen Zeitpunkt. ${running}`} legend={legend(flowSeries)} table={table(months, "month", "Monat", flowSeries, "count")}>
          <TimeChart kind="line" data={months} xKey="month" series={flowSeries} format="count" runningLast label="Liniendiagramm: Eingang, Erstbearbeitung und Abschluss je Monat" />
        </Figure>
        <Figure className="insights-grid__half" id="comparison-chart" title={`Eingänge ${periodTitle(period.kind, w.startDay)} kumuliert`} chip={`${elapsed} Tage`} summary={`Bis Tag ${elapsed}: ${formatNumber(currentTotal)} Eingänge; Vorzeitraum bis Tag ${elapsed}: ${formatNumber(previousSame)}.`} legend={legend(comparisonSeries)} table={table(comparison, "label", "Tag", comparisonSeries, "count")}>
          <TimeChart kind="line" data={comparison} xKey="label" series={comparisonSeries} format="count" height={220} label="Liniendiagramm: Eingänge kumuliert, aktueller Zeitraum und Vorzeitraum" />
        </Figure>
        <Figure className="insights-grid__half" id="season-chart" title="Saisonalität: Eingänge je Kalendermonat" chip={`ab ${season.years.slice(-3)[0] ?? ""}`} summary={`Eingänge je Monat für ${season.years.slice(-3).join(", ")}; Monate ohne Daten bleiben leer.`} legend={legend(seasonSeries)} table={table(season.data, "month", "Monat", seasonSeries, "count")}>
          <TimeChart kind="line" data={season.data} xKey="month" series={seasonSeries} format="count" height={220} label="Liniendiagramm: Eingänge je Kalendermonat und Jahr" />
        </Figure>
      </div>}

      {area === "warteschlangen" && <div className="insights-grid">
        {queueStats.map((queue) => (
          <Figure
            key={queue.key}
            id={`queue-${queue.key}`}
            stripe={queue.peak ? "attention" : "neutral"}
            title={queue.label}
            chip="90 Tage"
            summary={`Heute ${formatNumber(queue.today)} · Max. ${formatNumber(queue.max)}${queue.peak ? ` · ${queue.peak.text}` : ""}`}
            table={table(queues, "day", "Tag", [{ key: queue.key, label: queue.label, color: slot(0) }], "count")}
          >
            <TimeChart kind="line" data={queues} xKey="day" series={[{ key: queue.key, label: queue.label, color: queue.peak ? CHART_COLORS[1] : slot(0) }]} format="count" height={140} label={`Liniendiagramm: ${queue.label} am Tagesende, 90 Tage`} />
          </Figure>
        ))}
      </div>}

      {area === "finanzen" && <div className="insights-grid">
        <Figure
          className="insights-grid__full"
          id="finance-chart"
          title="Ausgestellt und bezahlt je Monat"
          chip="12 Monate"
          summary={`${monthLabel(`${today.slice(0, 7)}-01`)} enthält nur die bisherigen Tage.`}
          legend={legend(financeSeries)}
          table={table(last12, "month", "Monat", financeSeries, "eur")}
          lead={
            <div className="rw-figures">
              <div><span className="rw-card__note">Ausgestellt (brutto)</span><span className="rw-figure mono">{formatCurrency(issued12)}</span></div>
              <div><span className="rw-card__note">Zahlungseingang (brutto)</span><span className="rw-figure mono">{formatCurrency(paid12)}</span></div>
              <div><span className="rw-card__note">Differenz</span><span className="rw-figure mono">{formatCurrency(issued12 - paid12)}</span></div>
            </div>
          }
        >
          <TimeChart kind="bar" data={last12} xKey="month" series={financeSeries} format="eur" label="Säulendiagramm: ausgestellte Beträge und Zahlungseingänge je Monat" />
        </Figure>
      </div>}

      {area === "automatisierung" && <div className="insights-grid">
        <Figure
          className="insights-grid__half"
          id="share-chart"
          title="Anteil automatischer Erstbearbeitung"
          chip="24 Monate"
          summary={`Später korrigierte automatische Ergebnisse zählen als automatisch. ${running}${shareNow ? ` ${shareNow.month}: ${formatNumber(shareNow.automatic)} von ${formatNumber(shareNow.total)} automatisch${smallBaseHint(shareNow.total) ? " – kleine Basis, Wert schwankt noch" : ""}.` : ""}`}
          lead={shareNow && shareNow.share !== null ? <p className="rw-figure mono">{formatPercent(shareNow.share)}</p> : undefined}
          table={table(automation, "month", "Monat", [{ key: "share", label: "Anteil automatisch (%)", color: slot(0) }, { key: "automatic", label: "Automatisch", color: slot(0) }, { key: "corrected", label: "Davon korrigiert", color: slot(0) }, { key: "total", label: "Erstbearbeitungen", color: slot(0) }], "mixed")}
        >
          <TimeChart kind="line" data={automation} xKey="month" series={[{ key: "share", label: "Anteil automatisch", color: slot(0) }]} format="percent" variant="share" runningLast label="Liniendiagramm: Anteil automatischer Erstbearbeitung je Monat" />
        </Figure>
        <Figure
          className="insights-grid__half"
          id="savings-chart"
          title="Geschätzte Zeitersparnis"
          chip="24 Monate"
          summary={`${formatNumber(savedRequests)} automatisch und ohne Korrektur abgeschlossene Erstbearbeitungen × Basiswert der manuellen Bearbeitung. Schätzung, keine gemessene Zeit.`}
          lead={<p className="rw-figure mono">{formatMinutes(savedTotal)}</p>}
          table={table(automation, "month", "Monat", [{ key: "savedHours", label: "Stunden", color: slot(0) }, { key: "savedRequests", label: "Anfragen", color: slot(0) }, { key: "baseline", label: "Basiswert (min)", color: slot(0) }], "mixed")}
        >
          <TimeChart kind="bar" data={automation} xKey="month" series={[{ key: "savedHours", label: "Zeitersparnis", color: slot(0) }]} format="hours" variant="savings" label="Säulendiagramm: geschätzte Zeitersparnis je Monat" />
        </Figure>
        <section className="rw-card rw-card--list rw-card--flush rw-card--meta insights-grid__full" id="runs" aria-labelledby="runs-title">
          <header className="rw-card__header">
            <div className="rw-card__heading">
              <div>
                <h3 id="runs-title" className="rw-card__title">Läufe {periodTitle(period.kind, w.startDay)}</h3>
                <p className="rw-card__description rw-card__note">
                  <span className="mono">{formatNumber(runTotals.all)}</span> Läufe · <span className="mono">{formatNumber(runTotals.failed)}</span> fehlgeschlagen · <span className="mono">{formatNumber(runTotals.corrected)}</span> korrigiert
                </p>
              </div>
            </div>
            <PeriodChip>Zeitraum</PeriodChip>
          </header>
          <DataTable
            caption="Automatisierungsläufe"
            columns={[
              { key: "step", header: "Schritt", cell: (row) => label("automation_step", row.step), mobile: "title" },
              { key: "status", header: "Status", cell: (row) => statusInfo("automation_status", row.status).label },
              { key: "decision", header: "Entscheidung", cell: (row) => (row.decision ? label("automation_decision", row.decision) : "–") },
              { key: "runs", header: "Läufe", cell: (row) => formatNumber(row.runs), align: "end" },
              { key: "corrected", header: "Korrigiert", cell: (row) => formatNumber(row.corrected), align: "end" },
            ]}
            rows={runs}
            rowKey={(row) => `${row.step}-${row.status}-${row.decision ?? ""}`}
            empty={<EmptyState title="Keine Automatisierungsläufe im Zeitraum" />}
          />
        </section>
      </div>}
    </>
  );
}

function tableValue(format: ChartFormat | "mixed", value: unknown): string {
  if (value === null || value === undefined) return "–";
  const number = Number(value);
  if (format === "eur") return formatCurrency(number);
  if (format === "percent") return formatPercent(number);
  if (format === "hours") return `${formatNumber(number, 1)} h`;
  return formatNumber(number, Number.isInteger(number) ? 0 : 1);
}

// Chart card with the compact header bar of the list cards (Anfragen, Übersicht)
function Figure({ id, title, summary, chip, legend, table, lead, stripe = "neutral", className = "", children }: { id: string; title: string; summary: string; chip?: string; legend?: ReactNode; table: ReactNode; lead?: ReactNode; stripe?: "neutral" | "attention"; className?: string; children: ReactNode }) {
  return (
    <figure className={`figure rw-card rw-card--list rw-card--flush rw-card--${stripe} ${className}`} id={id} data-chart={id}>
      <figcaption className="rw-card__header">
        <h3 className="rw-card__title">{title}</h3>
        {chip && <PeriodChip>{chip}</PeriodChip>}
      </figcaption>
      <div className="rw-card--list__pad figure__body">
        <p className="rw-card__note">{summary}</p>
        {lead}
        {legend}
        {children}
        <details className="figure__table">
          <summary>Daten als Tabelle</summary>
          {table}
        </details>
      </div>
    </figure>
  );
}
