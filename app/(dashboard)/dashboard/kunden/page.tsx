import type { Metadata } from "next";
import Link from "next/link";
import { createCustomer } from "@/app/(dashboard)/dashboard/kunden/actions";
import { CustomerShell } from "@/components/dashboard/customer-shell";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { SaveForm, TextAreaField, TextField } from "@/components/dashboard/ui/save-form";
import { SearchSuggest } from "@/components/dashboard/ui/search-suggest";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { CUSTOMER_PAGE_SIZE, CUSTOMER_VIEWS, listCustomers, parseCustomerFilters, type CustomerFilters, type CustomerListItem } from "@/lib/dashboard/customers";
import { EMPTY, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Kunden" };

const DESCRIPTION = {
  aktiv: "Kunden mit Kundennummer und Standorten. Hier lassen sich Angaben korrigieren, etwa nach einem Fehler des Telefonassistenten.",
  inaktiv: "Deaktivierte Kunden. Der Telefonassistent findet sie nicht mehr; bestehende Anfragen bleiben verknüpft.",
  alle: "Alle Kunden, aktive und deaktivierte.",
} as const;

function query(filters: CustomerFilters, overrides: Partial<CustomerFilters>) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.view !== "aktiv") params.set("ansicht", next.view);
  if (next.q) params.set("suche", next.q);
  if (next.page > 1) params.set("seite", String(next.page));
  const text = params.toString();
  return `/dashboard/kunden${text ? `?${text}` : ""}`;
}

// Customer list (task-13-10): search over number, company, contact, e-mail and site address
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(rolesFor("/dashboard/kunden"));
  const filters = parseCustomerFilters(await searchParams);
  const { rows, total, counts, error } = await listCustomers(filters);
  const pages = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
  const current = CUSTOMER_VIEWS.find((view) => view.key === filters.view)!;

  const columns: Column<CustomerListItem>[] = [
    { key: "company", header: "Kunde", cell: (row) => <><strong className="rw-strong">{row.company_name}</strong><span className="cell-sub mono">{row.customer_number}</span></>, mobile: "title" },
    {
      key: "site",
      header: "Standort",
      cell: (row) => {
        const site = row.sites.find((item) => item.is_active) ?? row.sites[0];
        if (!site) return EMPTY;
        return <>{site.street_house_number}<span className="cell-sub"><span className="mono">{site.postal_code}</span> {site.city}{row.sites.length > 1 && ` · ${row.sites.length} Standorte`}</span></>;
      },
    },
    { key: "contact", header: "Kontakt", cell: (row) => <>{row.contact_name ?? EMPTY}<span className="cell-sub">{row.business_email ?? "keine E-Mail"}</span></>, mobile: "hide" },
    { key: "requests", header: "Anfragen", cell: (row) => <span className="mono">{formatNumber(row.requestCount)}</span>, align: "end" },
    ...(filters.view === "aktiv" ? [] : [{ key: "status", header: "Status", cell: (row: CustomerListItem) => (row.is_active ? "Aktiv" : "Inaktiv") }]),
  ];

  return (
    <CustomerShell
      current={filters.view}
      counts={counts}
      title={current.label}
      count={counts[filters.view]}
      description={DESCRIPTION[filters.view]}
      toolbar={(
        <div className="req2__toolbar">
          <form className="req2__search" method="get" role="search" aria-label="Kunden durchsuchen">
            <label className="sr-only" htmlFor="kunden-suche">Suche</label>
            <Icon name="search" size={18} />
            <SearchSuggest area="kunden" id="kunden-suche" name="suche" defaultValue={filters.q} placeholder="Nummer, Firma, Kontakt, PLZ oder Ort" />
            {filters.view !== "aktiv" && <input type="hidden" name="ansicht" value={filters.view} />}
            <button className="rw-button-secondary req2__search-btn" type="submit">Suchen</button>
          </form>
        </div>
      )}
    >
      <details className="action">
        <summary>Kunde anlegen</summary>
        <p className="section-note">Ohne Angabe vergibt das System die nächste freie Kundennummer. Der erste Standort ist Pflicht; weitere lassen sich danach hinzufügen.</p>
        <SaveForm action={createCustomer} submitLabel="Kunde anlegen">
          <div className="form-grid">
            <TextField name="company_name" label="Firma" required />
            <TextField name="customer_number" label="Kundennummer" hint="Leer lassen für automatische Vergabe." />
            <TextField name="contact_name" label="Ansprechperson" />
            <TextField name="business_email" label="E-Mail" type="email" hint="Für Eingangsbestätigungen an Bestandskunden." />
            <TextField name="phone_number" label="Telefon" type="tel" />
            <TextField name="street_house_number" label="Straße und Hausnummer" required />
            <TextField name="postal_code" label="Postleitzahl" required inputMode="numeric" />
            <TextField name="city" label="Ort" required />
            <TextField name="site_label" label="Standortbezeichnung" hint="z. B. Halle 3, Werk Nord" />
          </div>
          <TextAreaField name="notes" label="Notizen" rows={2} />
        </SaveForm>
      </details>

      {error && rows.length === 0 ? (
        <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
      ) : (
        <div className="side-page__list">
          <div className="side-page__list-bar">
            <p className="result-count" role="status">
              <strong>{formatNumber(total)} {total === 1 ? "Kunde" : "Kunden"}</strong>{filters.q && <> · Suche „{filters.q}“</>}
              {pages > 1 && <> · Seite <span className="mono">{filters.page}</span> von <span className="mono">{pages}</span></>}
            </p>
            <span>Sortiert nach Firma</span>
          </div>
          <DataTable
            caption={`Kunden · ${current.label}`}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/dashboard/kunden/${row.id}`}
            empty={(
              <EmptyState
                title={filters.q ? "Keine Kunden zu dieser Suche" : "Keine Kunden in dieser Ansicht"}
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
    </CustomerShell>
  );
}
