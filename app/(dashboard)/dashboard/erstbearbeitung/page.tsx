import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { SideMenu } from "@/components/dashboard/ui/side-menu";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadQueue, QUEUE_TABS, tabFor, type QueueKey, type QueueRow } from "@/lib/dashboard/queues";
import { PAGE_SIZE } from "@/lib/dashboard/requests";
import { formatDateTime, formatElapsed, formatNumber } from "@/lib/format";
import { label } from "@/lib/status";

export const metadata: Metadata = { title: "Erstbearbeitung" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Side menu groups (task-10-3, same layout as the request list): queues that need the dispatcher first
const GROUPS: Array<{ title: string; slugs: string[] }> = [
  { title: "Handlungsbedarf", slugs: ["pruefung", "antwort", "planung"] },
  { title: "Wartet", slugs: ["warten"] },
  { title: "Bestand", slugs: ["alle"] },
];
const ACTION_SLUGS = ["pruefung", "antwort", "planung"];
// Short labels for the menu; the heading keeps the full queue name
const MENU_LABEL: Record<string, string> = { pruefung: "Prüfung", antwort: "Kundenantwort", planung: "Zu planen", warten: "Wartet auf Kunde", alle: "Alle meine" };

const DESCRIPTION: Record<string, string> = {
  pruefung: "Die Erstbearbeitung braucht Ihre Prüfung: Analyse kontrollieren, korrigieren oder freigeben.",
  antwort: "Der Kunde hat geantwortet. Antwort lesen und die Anfrage weiterführen.",
  planung: "Erstbearbeitung abgeschlossen, aber noch kein Einsatz geplant.",
  warten: "Rückfrage an den Kunden läuft. Hier ist nichts zu tun, bis die Antwort eingeht.",
  alle: "Alle Ihnen zugewiesenen Anfragen, neueste zuerst.",
};

// Dispatcher work queues (task-4-x; task-10-3: side menu like the request list, queues needing action first)
export default async function IntakeQueuesPage({ searchParams }: Props) {
  const employee = await requireRole(rolesFor("/dashboard/erstbearbeitung"));
  const params = await searchParams;
  const tab = tabFor(typeof params.tab === "string" ? params.tab : undefined);
  const pageParam = Number.parseInt(typeof params.seite === "string" ? params.seite : "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const { counts, rows, total, now, holds, customerChecks, error } = await loadQueue(employee.id, tab, page);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const minutesSince = (value: string | null) => (value ? (now - new Date(value).getTime()) / 60000 : null);
  const overdue = (row: QueueRow) => Boolean(row.due_at && new Date(row.due_at).getTime() < now);

  const queueColumns: Column<QueueRow>[] = [
    { key: "number", header: "Nummer", cell: (row) => <span className="mono">{row.request_number}</span>, mobile: "title" },
    { key: "company", header: "Kunde", cell: (row) => <>{row.company_name}<span className="cell-sub">{row.city} · {label("service_kind", row.service_kind)}</span></> },
    {
      key: "priority",
      header: "Priorität",
      cell: (row) => (row.priority ? <StatusBadge kind="request_priority" value={row.priority} /> : <span className="cell-sub cell-sub--inline">Kunde: {label("customer_urgency", row.customer_urgency)}</span>),
    },
    {
      key: "due",
      header: "Frist",
      cell: (row) => (row.due_at ? (
        <span className={overdue(row) ? "due due--overdue" : "due"}>
          {overdue(row) && <strong>Überfällig · </strong>}
          {formatDateTime(row.due_at)}
        </span>
      ) : <span className="muted">Keine</span>),
    },
    { key: "waiting", header: "Wartet seit", cell: (row) => <>{formatElapsed(minutesSince(row.waiting_since))}<span className="cell-sub">{formatDateTime(row.waiting_since)}</span></> },
    { key: "notes", header: "Hinweise", cell: (row) => <Hints row={row} holdAt={row.id ? holds.get(row.id) : undefined} customerCheck={!!row.id && customerChecks.has(row.id)} /> },
  ];
  const allColumns: Column<QueueRow>[] = [
    queueColumns[0],
    queueColumns[1],
    { key: "intake", header: "Erstbearbeitung", cell: (row) => <StatusBadge kind="intake_status" value={row.intake_status} /> },
    { key: "work", header: "Arbeit", cell: (row) => <StatusBadge kind="work_status" value={row.work_status} /> },
    queueColumns[2],
    { key: "created", header: "Eingang", cell: (row) => formatDateTime(row.created_at) },
  ];

  const tabHref = (slug: string) => (slug === "pruefung" ? "/dashboard/erstbearbeitung" : `/dashboard/erstbearbeitung?tab=${slug}`);
  const countOf = (slug: string) => {
    const item = QUEUE_TABS.find((entry) => entry.slug === slug);
    return item?.queue ? counts[item.queue as QueueKey] : undefined;
  };
  const currentCount = tab.queue ? counts[tab.queue as QueueKey] : total;

  return (
    <div className="dash-page rw-page rw-page--tight side-page">
      <header className="side-page__head">
        <div className="side-page__head-text">
          <h1 id="queue-title" className="side-page__title">
            {tab.label}
            {!error && <span className="side-page__count mono">{formatNumber(currentCount)}</span>}
          </h1>
          <p className="side-page__desc">
            {DESCRIPTION[tab.slug]}
            {tab.slug === "planung" && <> <Link href="/dashboard/planung">Zur Einsatzplanung</Link></>}
          </p>
        </div>
        <div className="dash-page-header__actions">
          <Link className="rw-button-secondary" href="/dashboard/anfragen/neu"><Icon name="phone" size={18} />Telefonische Anfrage</Link>
          <Link className="rw-button-secondary" href="/dashboard/anfragen">Alle Anfragen durchsuchen</Link>
        </div>
      </header>

      <div className="side-page__grid">
        <SideMenu
          label="Warteschlangen"
          title="Erstbearbeitung"
          scope={["Ihre Arbeitswarteschlangen", "Jede Anfrage steht in höchstens einer Warteschlange."]}
          groups={GROUPS.map((group) => ({
            title: group.title,
            items: QUEUE_TABS.filter((item) => group.slugs.includes(item.slug)).map((item) => ({
              key: item.slug,
              label: MENU_LABEL[item.slug] ?? item.label,
              href: tabHref(item.slug),
              active: item.slug === tab.slug,
              count: countOf(item.slug),
              actionable: ACTION_SLUGS.includes(item.slug),
            })),
          }))}
        />

        <section className="side-page__main" aria-labelledby="queue-title">
          {error ? (
            <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
          ) : (
            <div className="side-page__list">
              <div className="side-page__list-bar">
                <p className="result-count" role="status">
                  <strong>{formatNumber(total)} {total === 1 ? "Anfrage" : "Anfragen"}</strong> · {tab.label}
                  {!tab.queue && pages > 1 && <> · Seite <span className="mono">{page}</span> von <span className="mono">{pages}</span></>}
                </p>
                <span>{tab.queue ? "Sortiert nach Priorität, Frist und Wartezeit" : "Neueste zuerst"}</span>
              </div>
              <DataTable
                caption={tab.label}
                columns={tab.queue ? queueColumns : allColumns}
                rows={rows}
                rowKey={(row) => row.id ?? ""}
                rowHref={(row) => `/dashboard/anfragen/${row.id}`}
                rowClassName={(row) => (row.safety_check_required ? "is-hazard" : undefined)}
                empty={<EmptyState tone={ACTION_SLUGS.includes(tab.slug) ? "good" : "neutral"} title={tab.empty} />}
              />
              {!tab.queue && pages > 1 && (
                <nav className="pagination" aria-label="Seiten">
                  {page > 1 ? <Link href={`/dashboard/erstbearbeitung?tab=alle&seite=${page - 1}`} rel="prev">← Zurück</Link> : <span aria-hidden="true" />}
                  <span>Seite <span className="mono">{page}</span> von <span className="mono">{pages}</span></span>
                  {page < pages ? <Link href={`/dashboard/erstbearbeitung?tab=alle&seite=${page + 1}`} rel="next">Weiter →</Link> : <span aria-hidden="true" />}
                </nav>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Hints({ row, holdAt, customerCheck }: { row: QueueRow; holdAt?: string; customerCheck: boolean }) {
  const hints: Array<{ text: string; tone: "info" | "warning" | "danger" }> = [];
  // Uncertain automatic customer match (task-14-2)
  if (customerCheck) hints.push({ text: "Kunde prüfen: möglicher Bestandskunde", tone: "warning" });
  if (holdAt) hints.push({ text: `Terminwunsch vorgemerkt: ${formatDateTime(holdAt)}`, tone: "info" });
  if (row.safety_check_required) hints.push({ text: "Sicherheitsgefahr: vor Planung prüfen", tone: "danger" });
  else if (row.safety_risk && row.safety_risk !== "none_known") hints.push({ text: `Sicherheitsgefahr ${label("safety_risk", row.safety_risk).toLowerCase()}`, tone: "warning" });
  if (row.queue === "planning" && row.work_status === "waiting_parts") hints.push({ text: "Folgeeinsatz nach Teilelieferung", tone: "info" });
  if (row.intake_mode === "automatic") hints.push({ text: "Automatisch bearbeitet", tone: "info" });
  if (row.queue === "reply_received" && row.intake_status === "analyzing") hints.push({ text: "Analyse läuft", tone: "info" });
  if (hints.length === 0) return <span className="muted">–</span>;
  return (
    <ul className="hint-list">
      {hints.map((hint) => <li key={hint.text} className={`hint hint--${hint.tone}`}>{hint.text}</li>)}
    </ul>
  );
}
