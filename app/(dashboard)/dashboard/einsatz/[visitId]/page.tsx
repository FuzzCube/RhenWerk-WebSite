import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { CheckboxField, FileField, HiddenField, SaveForm, SelectField, TextAreaField, TextField } from "@/components/dashboard/ui/save-form";
import { OrderFacts, visitStatus } from "@/components/dashboard/visit-card";
import { Card } from "@/components/dashboard/ui/card";
import { EmptyState } from "@/components/dashboard/ui/states";
import { StatusChip } from "@/components/dashboard/ui/status-chip";
import { Icon } from "@/components/ui";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { requireRole } from "@/lib/auth/session";
import { loadVisitWorkspace, type VisitWorkspace } from "@/lib/dashboard/visit";
import { formatCurrency, formatDateTime, formatElapsed, formatMinutes, formatNumber, formatTime, formatWeekdayDate } from "@/lib/format";
import { label } from "@/lib/status";
import { addWorkEntry, completeVisit, resumeVisit, setEntryStatus, startVisit, uploadPhoto, waitForParts } from "./actions";

export const metadata: Metadata = { title: "Einsatz" };

type Props = { params: Promise<{ visitId: string }> };

// Visit workspace for the planned technician (managers and admins may act as well)
export default async function VisitPage({ params }: Props) {
  const employee = await requireRole(["technician", "manager", "admin"]);
  const data = await loadVisitWorkspace((await params).visitId, employee);
  if (!data) notFound();
  const { visit, request } = data;
  const requestClosed = ["rejected", "cancelled"].includes(request.intake_status) || ["completed", "cancelled"].includes(request.work_status);
  const active = ["in_progress", "waiting_parts"].includes(visit.status);
  const canRecord = !requestClosed && !data.invoiceIssued && visit.status !== "cancelled" && visit.status !== "scheduled";
  const hourly = data.rates.find((rate) => rate.billing_model === "hourly");
  const fixed = data.rates.find((rate) => rate.billing_model === "fixed");
  const hasFixed = data.entries.some((entry) => entry.kind === "fixed_service" && entry.item_status !== "cancelled");

  const elapsed = visit.status === "in_progress" && data.elapsedMinutes !== null ? ` · ${formatElapsed(data.elapsedMinutes)}` : "";
  const status = visitStatus(visit.status);
  const activeEntries = data.entries.filter((entry) => entry.item_status !== "cancelled" && entry.visit_id === visit.id).length;
  const checklist = [
    { label: "Arbeit und Teile", done: activeEntries > 0, state: activeEntries > 0 ? `${activeEntries} erfasst` : "optional" },
    { label: "Fotos", done: data.photos.length > 0, state: data.photos.length > 0 ? `${data.photos.length} hochgeladen` : "optional" },
    { label: "Bericht", done: false, state: "im Formular unten" },
    { label: "Arbeitszeit", done: false, state: data.suggestedMinutes !== null ? `Vorschlag ${formatMinutes(data.suggestedMinutes)}` : "im Formular unten" },
  ];
  const back = employee.role === "technician" ? { href: "/dashboard/heute", label: "Mein Tag" } : { href: `/dashboard/anfragen/${request.id}`, label: request.request_number };
  const bar = visit.status === "scheduled" ? { main: { href: "#starten", label: "Arbeit starten" }, side: null }
    : visit.status === "in_progress" ? { main: { href: "#beenden", label: "Einsatz beenden" }, side: { href: "#teile", label: "Auf Teile warten" } }
    : visit.status === "waiting_parts" ? { main: { href: "#fortsetzen", label: "Einsatz fortsetzen" }, side: { href: "#beenden", label: "Beenden" } }
    : null;

  return (
    <div className={`dash-page rw-page rw-page--tight visit-page tech-page`}>
      <nav className="breadcrumb-dash" aria-label="Pfad">
        <Link href={back.href}>← {back.label}</Link>
      </nav>
      <header className="tech-visit-head">
        <p className="tech-now__time">
          <span className="mono">{formatWeekdayDate(visit.scheduled_start).replace(/\d{4}$/, "")} · {formatTime(visit.scheduled_start)}–{formatTime(visit.scheduled_end)}</span>
          <StatusChip status={{ ...status, label: `${status.label}${elapsed}` }} />
        </p>
        <h1>{request.company_name}</h1>
        <p className="tech-meta"><Link href={`/dashboard/anfragen/${request.id}`} className="mono">{request.request_number}</Link> · {label("service_kind", request.service_kind)} · {label("equipment_kind", request.equipment_kind)}</p>
      </header>
      {request.safety_risk !== "none_known" && (
        <div className="rw-banner rw-banner--danger" role="alert"><Icon name="hazard" size={20} /><p><strong>Sicherheitsgefahr: {label("safety_risk", request.safety_risk)}.</strong> Vor Arbeitsbeginn Sicherheitslage klären.</p></div>
      )}

      <Card headingLevel={2} title="Auftrag und Kontakt">
        <OrderFacts request={request} />
      </Card>

      {visit.status === "scheduled" && (
        <section id="starten" className="rw-card rw-card--action" aria-labelledby="start-title">
          <h2 id="start-title" className="rw-card__title">Arbeit beginnen</h2>
          <SaveForm action={startVisit} submitLabel="Arbeit starten"><Context data={data} /><p className="section-note">Startet den Einsatz jetzt und setzt die Anfrage auf „In Arbeit“.</p></SaveForm>
        </section>
      )}
      {visit.status === "waiting_parts" && (
        <section id="fortsetzen" className="rw-card rw-card--attention" aria-labelledby="resume-title">
          <h2 id="resume-title" className="rw-card__title">Wartet auf Teile</h2>
          <SaveForm action={resumeVisit} submitLabel="Einsatz fortsetzen" submitVariant="secondary"><Context data={data} /><p className="section-note">Grund: {visit.waiting_reason}. Fortsetzen ist nur im ursprünglichen Zeitraum möglich, wenn dieser noch frei ist.</p></SaveForm>
        </section>
      )}
      {visit.status === "cancelled" && <Card stripe="meta"><EmptyState title="Dieser Einsatz wurde storniert." /></Card>}

      <section className="rw-zone" aria-labelledby="doc-title">
        <h2 id="doc-title" className="tech-h2">Dokumentation</h2>

        <section className="rw-card rw-card--neutral tech-step" aria-labelledby="work-title">
          <h3 id="work-title" className="rw-card__title"><span className="tech-step__num mono">1</span>Arbeit und Teile <span className="tech-optional">Optional</span></h3>
          {data.invoiceIssued && <p className="section-note">Die Rechnung ist ausgestellt; Positionen können nicht mehr geändert werden.</p>}
          <EntryList data={data} canChange={!requestClosed && !data.invoiceIssued} />
          {canRecord && (
            <div className="action-list">
              {hourly && (
                <details className="action">
                  <summary>Arbeitszeit erfassen</summary>
                  <p className="section-note">Abgerechnet nach Tarif „{hourly.display_name}“ ({formatCurrency(hourly.unit_price)} je Stunde).</p>
                  <SaveForm action={addWorkEntry} submitLabel="Arbeitszeit speichern" submitVariant="secondary" resetOnSuccess>
                    <Context data={data} /><HiddenField name="kind" value="labor" /><HiddenField name="service_rate_id" value={hourly.id} />
                    <div className="form-grid">
                      <TextField name="quantity" label="Stunden" required inputMode="decimal" hint="z. B. 1,5" />
                      <TextField name="description" label="Tätigkeit" required defaultValue="Diagnose und Reparatur vor Ort" />
                    </div>
                  </SaveForm>
                </details>
              )}
              {fixed && !hasFixed && (
                <details className="action">
                  <summary>Pauschale erfassen</summary>
                  <p className="section-note">„{fixed.display_name}“ zu {formatCurrency(fixed.unit_price)}. Die Arbeitszeit steht im Einsatzbericht.</p>
                  <SaveForm action={addWorkEntry} submitLabel="Pauschale speichern" submitVariant="secondary">
                    <Context data={data} /><HiddenField name="kind" value="fixed_service" /><HiddenField name="service_rate_id" value={fixed.id} /><HiddenField name="quantity" value="1" />
                    <TextField name="description" label="Beschreibung" required defaultValue={fixed.display_name} />
                  </SaveForm>
                </details>
              )}
              <details className="action">
                <summary>Teil erfassen</summary>
                <SaveForm action={addWorkEntry} submitLabel="Teil speichern" submitVariant="secondary" resetOnSuccess>
                  <Context data={data} /><HiddenField name="kind" value="part" />
                  <div className="form-grid">
                    <TextField name="description" label="Teil" required />
                    <TextField name="quantity" label="Menge (Stück)" required inputMode="decimal" defaultValue="1" />
                    <TextField name="unit_price" label="Preis je Stück netto (€)" required inputMode="decimal" />
                    <SelectField name="item_status" label="Status" required defaultValue="used" options={[{ value: "used", label: "Verbaut" }, { value: "ordered", label: "Bestellt" }]} />
                  </div>
                </SaveForm>
              </details>
            </div>
          )}
        </section>

        <section className="rw-card rw-card--neutral tech-step" aria-labelledby="photos-title">
          <h3 id="photos-title" className="rw-card__title"><span className="tech-step__num mono">2</span>Fotos ({data.photos.length}) <span className="tech-optional">Optional</span></h3>
          {data.photos.length > 0 && (
            <ul className="photo-grid">
              {data.photos.map((photo) => {
                const href = `/dashboard/anfragen/${request.id}/dokumente/${photo.id}`;
                return (
                  <li key={photo.id}>
                    <a href={href} target="_blank" rel="noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private file streamed with the user's rights */}
                      <img src={href} alt={photo.file_name} loading="lazy" />
                    </a>
                    <span className="cell-sub">{photo.file_name} · {formatDateTime(photo.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {visit.status !== "cancelled" && !requestClosed && (
            <SaveForm action={uploadPhoto} submitLabel="Foto hochladen" submitVariant="secondary" resetOnSuccess>
              <Context data={data} />
              <FileField name="photo" label="Foto aufnehmen oder hochladen" accept="image/jpeg,image/png" required hint="JPEG oder PNG, höchstens 10 MB. Gespeichert im privaten Speicher, sichtbar nur für berechtigte Mitarbeitende." />
            </SaveForm>
          )}
        </section>

        {visit.status === "in_progress" && (
          <details id="teile" className="action rw-card rw-card--neutral tech-step">
            <summary>Auf Teile warten</summary>
            <p className="section-note">Pausiert den Einsatz. Der Zeitraum wird freigegeben; die Disposition plant nach Lieferung einen Folgeeinsatz oder der Einsatz wird fortgesetzt.</p>
            <SaveForm action={waitForParts} submitLabel="Einsatz pausieren" submitVariant="secondary"><Context data={data} /><TextAreaField name="reason" label="Welche Teile fehlen?" required rows={2} /></SaveForm>
          </details>
        )}

        {active && (
          <section id="beenden" className="rw-card rw-card--action tech-step" aria-labelledby="finish-title">
            <h3 id="finish-title" className="rw-card__title"><span className="tech-step__num mono">3</span>Bericht und Arbeitszeit <span className="tech-optional tech-optional--req">Pflichtangabe</span></h3>
            <ul className="tech-checklist" aria-label="Checkliste zum Beenden">
              {checklist.map((item) => (
                <li key={item.label} className={item.done ? "is-done" : item.state === "optional" ? "is-optional" : undefined}>
                  <Icon name={item.done ? "check-circle" : "clock"} size={18} />
                  <span>{item.label}</span>
                  <span className="tech-checklist__state">{item.state}</span>
                </li>
              ))}
            </ul>
            <details className="action" open>
              <summary>Einsatz beenden</summary>
              <p className="section-note">Beendet nur diesen Einsatz. Die Anfrage bleibt offen, bis sie nach allen Einsätzen abgeschlossen wird.</p>
              <SaveForm action={completeVisit} submitLabel="Einsatz beenden">
                <Context data={data} />
                <TextAreaField name="summary" label="Bericht: Was wurde festgestellt und gemacht?" required rows={4} />
                <div className="form-grid">
                  <TextField name="minutes" label="Tatsächliche Arbeitszeit (Minuten)" type="number" inputMode="numeric" required defaultValue={String(data.suggestedMinutes ?? "")} hint={data.elapsedMinutes !== null ? `Vorgeschlagen aus dem Start: ${formatMinutes(data.elapsedMinutes)}${data.suggestedMinutes !== data.elapsedMinutes ? " – eingetragen ist die geplante Dauer" : ""}. Bei Bedarf anpassen.` : undefined} />
                </div>
                <CheckboxField name="follow_up" label="Folgeeinsatz erforderlich" />
                <TextAreaField name="follow_up_reason" label="Grund für den Folgeeinsatz (nur bei Folgeeinsatz)" rows={2} />
              </SaveForm>
            </details>
          </section>
        )}

        {visit.status === "completed" && (
          <Card stripe="success" title="Einsatz beendet">
            <dl className="facts">
              <div><dt>Tatsächlich</dt><dd>{formatDateTime(visit.actual_start)} – {formatDateTime(visit.actual_end)}</dd></div>
              <div><dt>Arbeitszeit</dt><dd>{visit.actual_work_minutes === null ? "–" : formatMinutes(visit.actual_work_minutes)}</dd></div>
              <div><dt>Bericht</dt><dd>{visit.summary ?? "–"}</dd></div>
              <div><dt>Anfrage</dt><dd>{request.work_status === "completed" ? "Abgeschlossen" : "Noch offen – Abschluss auf der Anfrageseite"}</dd></div>
            </dl>
          </Card>
        )}
      </section>

      {bar && (
        <nav className={`tech-bar${bar.side ? "" : " tech-bar--single"}`} aria-label="Aktionen zum Einsatz">
          {bar.side && <a className="rw-button-secondary" href={bar.side.href}>{bar.side.label}</a>}
          <a className="button button--primary tech-main" href={bar.main.href}>{bar.main.label}</a>
        </nav>
      )}
    </div>
  );
}

// Visit, request and the request version the user saw
function Context({ data }: { data: VisitWorkspace }) {
  return (
    <>
      <HiddenField name="visit_id" value={data.visit.id} />
      <HiddenField name="request_id" value={data.request.id} />
      <HiddenField name="version" value={data.request.version} />
    </>
  );
}

function EntryList({ data, canChange }: { data: VisitWorkspace; canChange: boolean }) {
  const columns: Column<VisitWorkspace["entries"][number]>[] = [
    { key: "description", header: "Position", cell: (entry) => <>{entry.description}{entry.visit_id === data.visit.id && <span className="cell-sub">dieser Einsatz</span>}</>, mobile: "title" },
    { key: "kind", header: "Art", cell: (entry) => label("work_entry_kind", entry.kind) },
    { key: "quantity", header: "Menge", cell: (entry) => `${formatNumber(entry.quantity, entry.unit === "hour" ? 2 : 0)} ${label("work_unit", entry.unit)}`, align: "end" },
    { key: "price", header: "Einzelpreis", cell: (entry) => formatCurrency(entry.unit_price), align: "end" },
    { key: "status", header: "Status", cell: (entry) => <StatusBadge kind="work_item_status" value={entry.item_status} /> },
    {
      key: "change",
      header: "Ändern",
      cell: (entry) => {
        if (!canChange || entry.item_status === "cancelled") return <span className="muted">–</span>;
        return (
          <div className="entry-actions">
            {entry.kind === "part" && entry.item_status === "ordered" && (
              <SaveForm action={setEntryStatus} submitLabel="Als verbaut markieren" submitVariant="secondary">
                <Context data={data} /><HiddenField name="entry_id" value={entry.id} /><HiddenField name="new_status" value="used" />
              </SaveForm>
            )}
            <SaveForm action={setEntryStatus} submitLabel="Stornieren" submitVariant="secondary">
              <Context data={data} /><HiddenField name="entry_id" value={entry.id} /><HiddenField name="new_status" value="cancelled" />
            </SaveForm>
          </div>
        );
      },
    },
  ];
  return <DataTable caption="Arbeitspositionen der Anfrage" columns={columns} rows={data.entries} rowKey={(entry) => entry.id} empty={<EmptyState title="Noch keine Arbeitspositionen." />} />;
}
