import type { Metadata } from "next";
import Link from "next/link";
import { CallShell } from "@/components/dashboard/call-shell";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { SearchSuggest } from "@/components/dashboard/ui/search-suggest";
import { StatusChip } from "@/components/dashboard/ui/status-chip";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { CALL_PAGE_SIZE, CALL_VIEWS, callStatus, formatCallDuration, listCalls, parseCallFilters, type CallFilters, type CallListItem } from "@/lib/dashboard/calls";
import { EMPTY, formatDateTime, formatNumber } from "@/lib/format";
import { label } from "@/lib/status";

export const metadata: Metadata = { title: "Anrufe" };

const DESCRIPTION = {
  alle: "Gespräche des Telefonassistenten mit Zusammenfassung, Kategorie und Rückrufstand, neueste zuerst.",
  rueckruf: "Anrufe, bei denen ein Mensch zurückrufen muss. Nach dem Rückruf als erledigt vermerken.",
  notfall: "Notfälle, Sicherheitsgefahr, Produktionsstillstand und dringende Rückrufe.",
  anfrage: "Anrufe, in denen der Telefonassistent eine neue Anfrage angelegt hat.",
} as const;

function query(filters: CallFilters, overrides: Partial<CallFilters>) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.view !== "alle") params.set("ansicht", next.view);
  if (next.q) params.set("suche", next.q);
  if (next.page > 1) params.set("seite", String(next.page));
  const text = params.toString();
  return `/dashboard/anrufe${text ? `?${text}` : ""}`;
}

// Call list (task-13-7): search over company, contact, summary, phone numbers and request number
export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(rolesFor("/dashboard/anrufe"));
  const filters = parseCallFilters(await searchParams);
  const { rows, total, counts, error } = await listCalls(filters);
  const pages = Math.max(1, Math.ceil(total / CALL_PAGE_SIZE));
  const current = CALL_VIEWS.find((view) => view.key === filters.view)!;

  const columns: Column<CallListItem>[] = [
    {
      key: "when",
      header: "Anruf",
      cell: (row) => <><span className="mono">{formatDateTime(row.started_at)}</span><span className="cell-sub">{formatCallDuration(row.duration_seconds)}{row.in_service_hours === false && " · außerhalb der Servicezeit"}</span></>,
      mobile: "title",
    },
    { key: "caller", header: "Anrufer", cell: (row) => <><strong className="rw-strong">{row.company}</strong><span className="cell-sub">{row.contact ?? EMPTY}{row.is_demo && <> <span className="demo-tag">Demodaten</span></>}</span></> },
    {
      key: "topic",
      header: "Anliegen",
      cell: (row) => <>{row.category ? label("call_category", row.category) : "Noch nicht ausgewertet"}{row.forward_target && <> · weitergeleitet (Demo)</>}<span className="cell-sub call-summary">{row.summary ?? EMPTY}</span></>,
    },
    { key: "request", header: "Anfrage", cell: (row) => (row.request ? <span className="mono">{row.request.request_number}</span> : EMPTY), mobile: "hide" },
    { key: "status", header: "Stand", cell: (row) => <StatusChip status={callStatus(row)} /> },
  ];

  return (
    <CallShell
      current={filters.view}
      counts={counts}
      title={current.label}
      count={counts[filters.view]}
      description={DESCRIPTION[filters.view]}
      toolbar={(
        <div className="req2__toolbar">
          <form className="req2__search" method="get" role="search" aria-label="Anrufe durchsuchen">
            <label className="sr-only" htmlFor="anrufe-suche">Suche</label>
            <Icon name="search" size={18} />
            <SearchSuggest area="anrufe" id="anrufe-suche" name="suche" defaultValue={filters.q} placeholder="Firma, Kontakt, Anliegen, Rufnummer oder Anfrage" />
            {filters.view !== "alle" && <input type="hidden" name="ansicht" value={filters.view} />}
            <button className="rw-button-secondary req2__search-btn" type="submit">Suchen</button>
          </form>
        </div>
      )}
    >
      {error && rows.length === 0 ? (
        <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
      ) : (
        <div className="side-page__list">
          <div className="side-page__list-bar">
            <p className="result-count" role="status">
              <strong>{formatNumber(total)} {total === 1 ? "Anruf" : "Anrufe"}</strong>{filters.q && <> · Suche „{filters.q}“</>}
              {pages > 1 && <> · Seite <span className="mono">{filters.page}</span> von <span className="mono">{pages}</span></>}
            </p>
            <span>Neueste zuerst</span>
          </div>
          <DataTable
            caption={`Anrufe · ${current.label}`}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/dashboard/anrufe/${row.id}`}
            rowClassName={(row) => (row.callback_urgent && !row.callback_done_at ? "is-hazard" : undefined)}
            empty={(
              <EmptyState
                title={filters.q ? "Keine Anrufe zu dieser Suche" : "Keine Anrufe in dieser Ansicht"}
                action={filters.q ? <Link className="rw-button-secondary" href={query(filters, { q: "", page: 1 })}>Suche zurücksetzen</Link> : undefined}
              />
            )}
          />
          {pages > 1 && (
            <nav className="pagination" aria-label="Seiten">
              {filters.page > 1 ? <Link href={query(filters, { page: filters.page - 1 })} rel="prev">← Vorherige Seite</Link> : <span aria-hidden="true" />}
              <span>Seite <span className="mono">{filters.page}</span> von <span className="mono">{pages}</span></span>
              {filters.page < pages ? <Link href={query(filters, { page: filters.page + 1 })} rel="next">Nächste Seite →</Link> : <span aria-hidden="true" />}
            </nav>
          )}
        </div>
      )}
    </CallShell>
  );
}
