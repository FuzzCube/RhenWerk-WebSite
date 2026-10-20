import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { SearchSuggest } from "@/components/dashboard/ui/search-suggest";
import { SideMenu } from "@/components/dashboard/ui/side-menu";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { HazardFlag, PriorityText, RequestStatusChip } from "@/components/dashboard/ui/status-chip";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { DATE_FIELDS, countViews, customerCheckIds, filterQuery, getEmployeeNames, listRequests, openHoldStarts, PAGE_SIZE, parseRequestFilters, viewsFor, type RequestFilters, type RequestListItem, type RequestView } from "@/lib/dashboard/requests";
import { REQUEST_DISPLAY_STATUSES } from "@/lib/display-status";
import { DEFAULT_SORT, nextSort, REQUEST_SORTS, sortLabel, sortParam, type SortKey } from "@/lib/request-sort";
import { formatDate, formatDateTime, formatNumber, formatTime } from "@/lib/format";
import { label, STATUS } from "@/lib/status";

export const metadata: Metadata = { title: "Anfragen" };

const SCOPE = {
  admin: "Alle Anfragen",
  manager: "Alle Anfragen",
  dispatcher: "Ihnen zugewiesene Anfragen",
  technician: "Ihnen zugewiesene Anfragen und Anfragen mit eigenem Einsatz",
} as const;

// Side menu: views grouped by urgency, so the places that need someone come first
const GROUPS: Array<{ title: string; views: RequestView[] }> = [
  { title: "Handlungsbedarf", views: ["gefahr", "pruefung", "planen"] },
  { title: "Wartet", views: ["kunde"] },
  { title: "Bestand", views: ["meine", "offen", "alle"] },
];
const ACTION_VIEWS: readonly RequestView[] = ["gefahr", "pruefung", "planen"];

const DESCRIPTION: Record<RequestView, string> = {
  gefahr: "Offene Anfragen mit bekannter oder unklarer Sicherheitsgefahr. Vor jedem weiteren Schritt prüfen.",
  pruefung: "Die Erstbearbeitung braucht eine Prüfung durch einen Menschen, bevor es weitergeht.",
  planen: "Erstbearbeitung abgeschlossen, aber noch kein Einsatz geplant.",
  kunde: "Rückfrage an den Kunden läuft. Die Anfrage geht weiter, sobald die Antwort da ist.",
  meine: "Offene Anfragen, die Ihnen zugewiesen sind.",
  offen: "Alle offenen Anfragen, die Sie sehen dürfen.",
  alle: "Alle Anfragen, auch abgeschlossene, abgelehnte und stornierte.",
};

// Request list (task-4-3; redesigned in task-10-3: canvas "Anfragen – Liste", then 12.10.2026 after user
// feedback): views as a side menu grouped by urgency, one heading with the meaning of the chosen view,
// search and a compact filter panel with removable chips for active filters. Sortable by column header and the
// "Sortiert" menu (task-12-12).
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const employee = await requireRole(rolesFor("/dashboard/anfragen"));
  const filters = parseRequestFilters(await searchParams);
  // Only manager and admin have the dispatcher column, so only they may sort by it
  const showsDispatcher = employee.role === "manager" || employee.role === "admin";
  if (filters.sort.key === "dispatcher" && !showsDispatcher) filters.sort = DEFAULT_SORT;
  const [{ rows, total, error }, names, counts] = await Promise.all([listRequests(filters, employee.id), getEmployeeNames(), countViews(employee.role, employee.id)]);
  const [holds, customerChecks] = employee.role === "technician"
    ? [new Map<string, string>(), new Set<string>()]
    : await Promise.all([openHoldStarts(rows.map((row) => row.id)), customerCheckIds(rows.map((row) => row.id))]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const views = viewsFor(employee.role);
  const current = views.find((view) => view.key === filters.view) ?? views[0];
  const further = Boolean(filters.intake || filters.work || filters.priority || filters.display);
  const filtered = Boolean(filters.q || further || filters.field || filters.mode || filters.open || filters.hazard);
  const href = (overrides: Partial<RequestFilters>) => `/dashboard/anfragen${filterQuery(filters, { page: 1, ...overrides })}`;
  const chips = activeChips(filters, href);
  const furtherCount = [filters.display, filters.intake, filters.work, filters.priority].filter(Boolean).length;

  // Column header link: the active column turns around, another one starts in its natural direction
  const sortable = (key: SortKey): Column<RequestListItem>["sort"] => {
    const next = nextSort(filters.sort, key);
    return {
      href: href({ sort: next }),
      active: filters.sort.key === key ? (filters.sort.dir === "auf" ? "ascending" : "descending") : null,
      title: `Sortieren: ${sortLabel(next)}`,
    };
  };
  const sortOptions = (Object.keys(REQUEST_SORTS) as SortKey[]).filter((key) => key !== "dispatcher" || showsDispatcher)
    .flatMap((key) => [REQUEST_SORTS[key].first, REQUEST_SORTS[key].first === "ab" ? "auf" : "ab"].map((dir) => ({ key, dir: dir as "auf" | "ab" })));
  const columns: Column<RequestListItem>[] = [
    { key: "number", header: "Anfrage", cell: (row) => <><span className="mono">{row.request_number}</span><HazardFlag risk={row.safety_risk} />{holds.has(row.id) && <span className="rw-flag rw-flag--hold" title={`Vorgemerkt: ${formatDateTime(holds.get(row.id)!)}`}>Terminwunsch</span>}{customerChecks.has(row.id) && <span className="rw-flag rw-flag--customer" title="Möglicher Bestandskunde: Zuordnung auf der Anfrageseite prüfen">Kunde prüfen</span>}</>, mobile: "title", sort: sortable("anfrage") },
    { key: "company", header: "Kunde", cell: (row) => <><strong className="rw-strong">{row.company_name}</strong><span className="cell-sub">{row.customer_number && <><span className="mono">{row.customer_number}</span> · </>}{row.city}</span></>, sort: sortable("kunde") },
    { key: "service", header: "Leistung", cell: (row) => <>{label("service_kind", row.service_kind)}<span className="cell-sub">{label("equipment_kind", row.equipment_kind)}</span></>, mobile: "hide", tablet: "hide", sort: sortable("leistung") },
    { key: "status", header: "Status", cell: (row) => <RequestStatusChip intakeStatus={row.intake_status} workStatus={row.work_status} /> },
    { key: "priority", header: "Priorität", cell: (row) => <PriorityText priority={row.priority} />, sort: sortable("prioritaet") },
    // A dispatcher only sees requests assigned to them, so the column would always show their own name
    ...(!showsDispatcher ? [] : [{
      key: "dispatcher",
      header: "Dispatcher",
      cell: (row: RequestListItem) => (row.dispatcher_id ? names.get(row.dispatcher_id) : <span className="rw-unassigned">Nicht zugewiesen</span>),
      mobile: "hide" as const,
      tablet: "hide" as const,
      sort: sortable("dispatcher"),
    }]),
    { key: "created", header: "Eingang", cell: (row) => <><span className="mono">{formatDate(row.created_at)}</span><span className="cell-sub mono">{formatTime(row.created_at)}</span></>, sort: sortable("eingang") },
  ];

  return (
    <div className="dash-page rw-page rw-page--tight side-page">
      <header className="side-page__head">
        <div className="side-page__head-text">
          <h1 id="view-title" className="side-page__title">
            {current.key === "gefahr" && <Icon name="hazard" size={22} />}
            {current.label}
            <span className="side-page__count mono">{counts[current.key] === undefined ? "–" : formatNumber(counts[current.key]!)}</span>
          </h1>
          <p className="side-page__desc">
            {DESCRIPTION[current.key]}
            {current.key === "planen" && <> <Link href="/dashboard/planung">Zur Einsatzplanung</Link></>}
          </p>
        </div>
        <div className="req2__toolbar">
          {employee.role !== "technician" && (
            <Link className="rw-button-secondary req2__new" href="/dashboard/anfragen/neu" title="Telefonische Anfrage anlegen"><Icon name="phone" size={18} /><span className="req2__new-label">Telefonische Anfrage</span></Link>
          )}
          <form className="req2__search" method="get" role="search" aria-label="Anfragen durchsuchen">
            <label className="sr-only" htmlFor="filter-suche">Suche</label>
            <Icon name="search" size={18} />
            <SearchSuggest area="anfragen" id="filter-suche" name="suche" defaultValue={filters.q} placeholder="Nummer, Firma, Kundennummer, Kontakt oder Ort" />
            <HiddenFilters filters={filters} skip="suche" />
            <button className="rw-button-secondary req2__search-btn" type="submit">Suchen</button>
          </form>

          <details className="req2__filter">
            <summary className={`req2__filter-btn${furtherCount ? " is-active" : ""}`}>
              <Icon name="filter" size={18} />Filter{furtherCount > 0 && <span className="req2__filter-count mono">{furtherCount}</span>}
            </summary>
            <form className="req2__filter-panel" method="get" aria-label="Anfragen filtern">
              <p className="req2__filter-note">Zusätzlich zur Ansicht „{current.label}“, zum Kombinieren mehrerer Merkmale.</p>
              <label className="field" htmlFor="filter-anzeige">
                <span>Status</span>
                <select id="filter-anzeige" name="anzeige" defaultValue={filters.display}>
                  <option value="">Alle</option>
                  {REQUEST_DISPLAY_STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}
                </select>
              </label>
              <FilterSelect name="prioritaet" label="Priorität" value={filters.priority} options={STATUS.request_priority} />
              <FilterSelect name="erstbearbeitung" label="Erstbearbeitung" value={filters.intake} options={STATUS.intake_status} />
              <FilterSelect name="arbeit" label="Arbeit" value={filters.work} options={STATUS.work_status} />
              <HiddenFilters filters={filters} skip="further" />
              <div className="req2__filter-actions">
                <button className="button button--primary" type="submit">Filter anwenden</button>
                {further && <Link className="rw-link-btn" href={href({ intake: "", work: "", priority: "", display: "" })}>Zurücksetzen</Link>}
              </div>
            </form>
          </details>
        </div>
      </header>

      <div className="side-page__grid">
        <SideMenu
          label="Ansichten"
          title="Anfragen"
          scope={[SCOPE[employee.role], <><span className="mono">{formatNumber(counts.alle ?? 0)}</span> insgesamt · <span className="mono">{formatNumber(counts.offen ?? 0)}</span> offen</>]}
          groups={GROUPS.map((group) => ({
            title: group.title,
            items: views.filter((view) => group.views.includes(view.key)).map((view) => ({
              key: view.key,
              label: view.label,
              href: href({ view: view.key }),
              active: view.key === current.key,
              count: counts[view.key] ?? null,
              actionable: ACTION_VIEWS.includes(view.key),
              hazard: view.key === "gefahr",
            })),
          }))}
        />

        <section className="side-page__main" aria-labelledby="view-title">
          {error ? (
            <ErrorState title="Die Anfragen konnten nicht geladen werden." action={<Link className="rw-button-secondary" href={`/dashboard/anfragen${filterQuery(filters)}`}>Erneut versuchen</Link>}>
              Suche und Filter bleiben erhalten.
            </ErrorState>
          ) : (
            <div className="side-page__list">
              {chips.length > 0 && (
                <ul className="req2__chips" aria-label="Aktive Filter">
                  {chips.map((chip) => (
                    <li key={chip.label}>
                      <Link className="req2__chip" href={chip.remove} aria-label={`${chip.label} entfernen`}>
                        {chip.label}<Icon name="x" size={14} />
                      </Link>
                    </li>
                  ))}
                  {chips.length > 1 && (
                    <li><Link className="rw-link-btn" href={href({ q: "", intake: "", work: "", priority: "", display: "", field: "", from: "", to: "", mode: "", open: false, hazard: false })}>Alle entfernen</Link></li>
                  )}
                </ul>
              )}
              <div className="side-page__list-bar">
                <p className="result-count" role="status">
                  <strong>{formatNumber(total)} {total === 1 ? "Anfrage" : "Anfragen"}</strong> · {current.label}
                  {total > 0 && pages > 1 && <> · Seite <span className="mono">{filters.page}</span> von <span className="mono">{pages}</span></>}
                </p>
                <details className="req-sort">
                  <summary>Sortiert: <strong>{sortLabel(filters.sort)}</strong><Icon name="chevron-down" size={16} /></summary>
                  <ul aria-label="Sortierung wählen">
                    {sortOptions.map((option) => {
                      const active = option.key === filters.sort.key && option.dir === filters.sort.dir;
                      return <li key={`${option.key}-${option.dir}`}><Link href={href({ sort: option })} scroll={false} aria-current={active ? "true" : undefined}>{sortLabel(option)}</Link></li>;
                    })}
                  </ul>
                </details>
              </div>
              <DataTable
                caption={`Anfragen · ${current.label}`}
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                rowHref={(row) => `/dashboard/anfragen/${row.id}`}
                rowClassName={(row) => (row.safety_risk === "known" || row.safety_risk === "unclear" ? "is-hazard" : undefined)}
                empty={
                  <EmptyState
                    tone={!filtered && ACTION_VIEWS.includes(current.key) ? "good" : "neutral"}
                    title={!filtered && ACTION_VIEWS.includes(current.key) ? "Nichts zu tun" : filters.view === "offen" && !filtered ? "Keine offenen Anfragen" : "Keine Anfragen in dieser Ansicht"}
                    action={filtered || filters.view !== "offen" ? (
                      <>
                        {filtered && <Link className="rw-button-secondary" href={href({ q: "", intake: "", work: "", priority: "", display: "", field: "", from: "", to: "", mode: "", open: false, hazard: false })}>Suche und Filter zurücksetzen</Link>}
                        <Link className="rw-link-btn" href="/dashboard/anfragen?ansicht=offen">Alle offenen anzeigen</Link>
                      </>
                    ) : undefined}
                  >
                    {[filters.q && `Suche „${filters.q}“`, `Ansicht „${current.label}“`, ...chips.filter((chip) => !chip.search).map((chip) => chip.label)].filter(Boolean).join(" · ")}
                  </EmptyState>
                }
              />
              {pages > 1 && (
                <nav className="pagination" aria-label="Seiten">
                  {filters.page > 1 ? <Link href={`/dashboard/anfragen${filterQuery(filters, { page: filters.page - 1 })}`} rel="prev">← Vorherige Seite</Link> : <span aria-hidden="true" />}
                  <span>Seite <span className="mono">{filters.page}</span> von <span className="mono">{pages}</span></span>
                  {filters.page < pages ? <Link href={`/dashboard/anfragen${filterQuery(filters, { page: filters.page + 1 })}`} rel="next">Nächste Seite →</Link> : <span aria-hidden="true" />}
                </nav>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Keeps the other filters when one form is submitted
function HiddenFilters({ filters, skip }: { filters: RequestFilters; skip: "suche" | "further" }) {
  return (
    <>
      <input type="hidden" name="ansicht" value={filters.view} />
      {sortParam(filters.sort) && <input type="hidden" name="sortierung" value={sortParam(filters.sort)!} />}
      {skip !== "suche" && filters.q && <input type="hidden" name="suche" value={filters.q} />}
      {skip !== "further" && (
        <>
          {filters.display && <input type="hidden" name="anzeige" value={filters.display} />}
          {filters.intake && <input type="hidden" name="erstbearbeitung" value={filters.intake} />}
          {filters.work && <input type="hidden" name="arbeit" value={filters.work} />}
          {filters.priority && <input type="hidden" name="prioritaet" value={filters.priority} />}
        </>
      )}
      {/* Selection from the overview stays active when filtering further */}
      {filters.field && <><input type="hidden" name="feld" value={filters.field} /><input type="hidden" name="von" value={filters.from} /><input type="hidden" name="bis" value={filters.to} /></>}
      {filters.mode && <input type="hidden" name="modus" value={filters.mode} />}
      {filters.open && <input type="hidden" name="status" value="offen" />}
      {filters.hazard && <input type="hidden" name="gefahr" value="1" />}
    </>
  );
}

// Every active search, filter and overview selection as a chip with a link that removes only it
function activeChips(filters: RequestFilters, href: (overrides: Partial<RequestFilters>) => string) {
  const chips: Array<{ label: string; remove: string; search?: boolean }> = [];
  if (filters.q) chips.push({ label: `Suche: „${filters.q}“`, remove: href({ q: "" }), search: true });
  if (filters.display) chips.push({ label: `Status: ${REQUEST_DISPLAY_STATUSES.find((status) => status.key === filters.display)?.label ?? filters.display}`, remove: href({ display: "" }) });
  if (filters.priority) chips.push({ label: `Priorität: ${STATUS.request_priority[filters.priority]?.label ?? filters.priority}`, remove: href({ priority: "" }) });
  if (filters.intake) chips.push({ label: `Erstbearbeitung: ${STATUS.intake_status[filters.intake]?.label ?? filters.intake}`, remove: href({ intake: "" }) });
  if (filters.work) chips.push({ label: `Arbeit: ${STATUS.work_status[filters.work]?.label ?? filters.work}`, remove: href({ work: "" }) });
  if (filters.field) chips.push({ label: `${DATE_FIELDS[filters.field].label} ${formatDate(filters.from)} ${formatTime(filters.from)} bis vor ${formatDate(filters.to)} ${formatTime(filters.to)}`, remove: href({ field: "", from: "", to: "" }) });
  if (filters.mode) chips.push({ label: `Bearbeitungsart: ${label("intake_mode", filters.mode)}`, remove: href({ mode: "" }) });
  if (filters.open) chips.push({ label: "Nur offene", remove: href({ open: false }) });
  if (filters.hazard) chips.push({ label: "Mit Sicherheitsgefahr", remove: href({ hazard: false }) });
  return chips;
}

function FilterSelect({ name, label: text, value, options }: { name: string; label: string; value: string; options: Record<string, { label: string }> }) {
  return (
    <label className="field" htmlFor={`filter-${name}`}>
      <span>{text}</span>
      <select id={`filter-${name}`} name={name} defaultValue={value}>
        <option value="">Alle</option>
        {Object.entries(options).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}
      </select>
    </label>
  );
}
