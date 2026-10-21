import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addSite, updateCustomer, updateSite } from "@/app/(dashboard)/dashboard/kunden/actions";
import { CustomerShell } from "@/components/dashboard/customer-shell";
import { ContractBadge } from "@/components/dashboard/ui/contract-badge";
import { CopyValue } from "@/components/dashboard/ui/copy-value";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { CheckboxField, HiddenField, SaveForm, TextAreaField, TextField } from "@/components/dashboard/ui/save-form";
import { EmptyState } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { RequestStatusChip } from "@/components/dashboard/ui/status-chip";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getCustomer, type CustomerRequest } from "@/lib/dashboard/customers";
import { berlinDayKey, EMPTY, formatDate, formatDateTime } from "@/lib/format";
import { contractTerm } from "@/lib/service-contract";
import { label } from "@/lib/status";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Kunde" };

// One customer (task-13-10): master data with customer number and main address (task-15-1; read-only, edit form behind „Stammdaten ändern“, task-12-8), sites (the phone assistant checks the postal code of an active site),
// linked requests. Customers and sites are deactivated, not deleted, so linked requests keep their reference.
export default async function CustomerPage({ params, searchParams }: Props) {
  await requireRole(rolesFor("/dashboard/kunden"));
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const detail = await getCustomer(id);
  if (!detail) notFound();
  const { customer, sites, requests, contracts } = detail;
  const today = berlinDayKey(new Date());
  // Main address: the oldest active site (sites come ordered by creation)
  const mainSite = sites.find((site) => site.is_active);
  const siteText = new Map(sites.map((site) => [site.id, `${site.street_house_number}, ${site.city}`]));

  const requestColumns: Column<CustomerRequest>[] = [
    { key: "number", header: "Anfrage", cell: (row) => <><span className="mono">{row.request_number}</span><span className="cell-sub">{formatDate(row.created_at)}</span></>, mobile: "title" },
    { key: "service", header: "Leistung", cell: (row) => <>{label("service_kind", row.service_kind)}<span className="cell-sub">{label("equipment_kind", row.equipment_kind)}</span></> },
    { key: "site", header: "Standort", cell: (row) => (row.customer_site_id ? siteText.get(row.customer_site_id) : `${row.street_house_number}, ${row.city}`), mobile: "hide" },
    { key: "status", header: "Status", cell: (row) => <RequestStatusChip intakeStatus={row.intake_status} workStatus={row.work_status} /> },
  ];

  return (
    <CustomerShell
      current={null}
      counts={null}
      title={customer.company_name}
      description={<>{customer.is_active ? "aktiv" : "deaktiviert"} · zuletzt geändert <span className="mono">{formatDateTime(customer.updated_at)}</span>{customer.is_demo && <> <span className="demo-tag">Demodaten</span></>}</>}
    >
      <p><Link href="/dashboard/kunden">← Alle Kunden</Link></p>
      {query.angelegt === "1" && <p className="notice" role="status">Kunde <span className="mono">{customer.customer_number}</span> angelegt.</p>}

      <section className="request-section" aria-labelledby="stammdaten-title">
        <h2 id="stammdaten-title">Stammdaten</h2>
        <dl className="facts">
          <div><dt>Kundennummer</dt><dd data-customer-number><CopyValue value={customer.customer_number} label="Kundennummer" /></dd></div>
          <div><dt>Firma</dt><dd>{customer.company_name}</dd></div>
          <div><dt>Anschrift</dt><dd data-main-address>{mainSite
            ? <>{mainSite.street_house_number}<br /><span className="mono">{mainSite.postal_code}</span> {mainSite.city}{mainSite.label && <span className="cell-sub">{mainSite.label}</span>}</>
            : <>Noch kein aktiver Standort – <a href="#standorte-title">unten hinzufügen</a></>}</dd></div>
          <div><dt>Ansprechperson</dt><dd>{customer.contact_name ?? EMPTY}</dd></div>
          <div><dt>E-Mail</dt><dd>{customer.business_email ? <a href={`mailto:${customer.business_email}`}>{customer.business_email}</a> : EMPTY}</dd></div>
          <div><dt>Telefon</dt><dd>{customer.phone_number ? <a className="mono" href={`tel:${customer.phone_number.replace(/[^\d+]/g, "")}`}>{customer.phone_number}</a> : EMPTY}</dd></div>
          {/* SLA contracts by customer number (task-16-3), read-only */}
          <div><dt>SLA-Vertrag</dt><dd data-contracts>{contracts.length === 0 ? "Keiner" : contracts.map((contract) => (
            <span key={contract.contract_number} className="contract-line">
              <span className="mono">{contract.contract_number}</span> <ContractBadge contract={contract} today={today} />
              <span className="cell-sub">{contractTerm(contract)} · {contract.postal_codes.length > 0 ? <>Standorte <span className="mono">{contract.postal_codes.join(", ")}</span></> : "alle Standorte"}</span>
            </span>
          ))}</dd></div>
          <div><dt>Status</dt><dd>{customer.is_active ? "Aktiv" : "Deaktiviert"}</dd></div>
          <div><dt>Herkunft</dt><dd data-origin>{customer.origin_request_id
            ? <>Automatisch aus {customer.origin ? <Link className="mono" href={`/dashboard/anfragen/${customer.origin.id}`}>{customer.origin.request_number}</Link> : "einer Anfrage"} angelegt</>
            : "Manuell angelegt"}</dd></div>
          <div><dt>Notizen</dt><dd className="pre-line">{customer.notes || EMPTY}</dd></div>
        </dl>
        <details className="action">
          <summary>Stammdaten ändern</summary>
          <p className="section-note">
            Die E-Mail-Adresse erhält bei Anrufen eines Bestandskunden die Eingangsbestätigung. Die Kundennummer ist fest.
            Deaktivierte Kunden findet der Telefonassistent nicht mehr.
          </p>
          <SaveForm action={updateCustomer} closeOnSuccess>
            <HiddenField name="customer_id" value={customer.id} />
            <HiddenField name="version" value={customer.version} />
            <div className="form-grid">
              <TextField name="company_name" label="Firma" required defaultValue={customer.company_name} />
              <TextField name="contact_name" label="Ansprechperson" defaultValue={customer.contact_name ?? ""} />
              <TextField name="business_email" label="E-Mail" type="email" defaultValue={customer.business_email ?? ""} />
              <TextField name="phone_number" label="Telefon" type="tel" defaultValue={customer.phone_number ?? ""} />
            </div>
            <TextAreaField name="notes" label="Notizen" rows={2} defaultValue={customer.notes ?? ""} />
            <CheckboxField name="is_active" label="Aktiv" defaultChecked={customer.is_active} />
          </SaveForm>
        </details>
      </section>

      <section className="request-section" aria-labelledby="standorte-title">
        <h2 id="standorte-title">Standorte</h2>
        <p className="section-note">Ein Anrufer mit Kundennummer wird nur erkannt, wenn die Postleitzahl eines aktiven Standorts passt.</p>
        {sites.length === 0 ? (
          <EmptyState title="Noch kein Standort." />
        ) : (
          <ul className="rate-list" aria-label="Standorte">
            {sites.map((site) => (
              <li key={site.id}>
                <details className="action">
                  <summary>
                    <span className="rate-list__head">
                      <span>{site.street_house_number}</span>
                      <span className="cell-sub cell-sub--inline"><span className="mono">{site.postal_code}</span> {site.city}{site.label && <> · {site.label}</>}</span>
                    </span>
                    <StatusBadge kind="profile_active" value={site.is_active} />
                  </summary>
                  <SaveForm action={updateSite} submitLabel="Standort speichern">
                    <HiddenField name="site_id" value={site.id} />
                    <HiddenField name="version" value={site.version} />
                    <div className="form-grid">
                      <TextField name="street_house_number" label="Straße und Hausnummer" required defaultValue={site.street_house_number} />
                      <TextField name="postal_code" label="Postleitzahl" required inputMode="numeric" defaultValue={site.postal_code} />
                      <TextField name="city" label="Ort" required defaultValue={site.city} />
                      <TextField name="label" label="Bezeichnung" defaultValue={site.label ?? ""} />
                    </div>
                    <CheckboxField name="is_active" label="Aktiv" defaultChecked={site.is_active} />
                  </SaveForm>
                </details>
              </li>
            ))}
          </ul>
        )}
        <details className="action">
          <summary>Standort hinzufügen</summary>
          <SaveForm action={addSite} submitLabel="Hinzufügen" resetOnSuccess>
            <HiddenField name="customer_id" value={customer.id} />
            <div className="form-grid">
              <TextField name="street_house_number" label="Straße und Hausnummer" required />
              <TextField name="postal_code" label="Postleitzahl" required inputMode="numeric" />
              <TextField name="city" label="Ort" required />
              <TextField name="label" label="Bezeichnung" hint="z. B. Halle 3, Werk Nord" />
            </div>
          </SaveForm>
        </details>
      </section>

      <section className="request-section" aria-labelledby="anfragen-title">
        <h2 id="anfragen-title">Anfragen</h2>
        <DataTable
          caption="Anfragen des Kunden"
          columns={requestColumns}
          rows={requests}
          rowKey={(row) => row.id}
          rowHref={(row) => `/dashboard/anfragen/${row.id}`}
          empty={<EmptyState title="Keine verknüpften Anfragen, die Sie sehen dürfen." />}
        />
      </section>
    </CustomerShell>
  );
}
