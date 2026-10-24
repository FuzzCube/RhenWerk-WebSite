import { closeRequest, createDraft, createInvoice, deleteDraft, issueInvoice, queueDraft, rejectRequest, saveIntake, updateDraft } from "@/app/(dashboard)/dashboard/anfragen/[id]/actions";
import type { ReactNode } from "react";
import { HiddenField, SaveForm, SelectField, TextAreaField, TextField } from "@/components/dashboard/ui/save-form";
import type { Employee } from "@/lib/auth/session";
import type { RequestDetail } from "@/lib/dashboard/requests";
import { formatCurrency } from "@/lib/format";
import { LABELS, STATUS, statusInfo } from "@/lib/status";

const OPEN_VISITS: readonly string[] = ["scheduled", "in_progress", "waiting_parts"];

// Which actions are possible; the database operations enforce the same rules again.
export function availableActions(detail: RequestDetail, employee: Pick<Employee, "id" | "role">) {
  const r = detail.request;
  const role = employee.role;
  const staff = role !== "technician";
  // Completion and invoicing: current technician, manager or admin (no manager approval needed)
  const billing = role === "manager" || role === "admin" || (role === "technician" && r.technician_id === employee.id);
  const terminal = ["rejected", "cancelled"].includes(r.intake_status) || ["completed", "cancelled"].includes(r.work_status);
  const openIntake = ["new", "analyzing", "needs_review"].includes(r.intake_status);
  return {
    complete: staff && openIntake,
    correct: staff && !terminal,
    email: staff && !terminal,
    await: staff && openIntake,
    reject: staff && !["rejected", "cancelled"].includes(r.intake_status) && ["not_planned", "scheduled"].includes(r.work_status),
    close: billing && r.intake_status === "processed" && !terminal && detail.visits.some((visit) => visit.status === "completed"),
    createInvoice: billing && r.intake_status === "processed" && r.work_status === "completed" && !detail.invoice,
    issueInvoice: billing && r.work_status === "completed" && detail.invoice?.status === "draft",
  };
}

const priorityOptions = Object.entries(STATUS.request_priority).map(([value, info]) => ({ value, label: info.label }));
const serviceOptions = Object.entries(LABELS.service_kind).map(([value, text]) => ({ value, label: text }));

function Context({ detail }: { detail: RequestDetail }) {
  return (
    <>
      <HiddenField name="request_id" value={detail.request.id} />
      <HiddenField name="version" value={detail.request.version} />
      <HiddenField name="seen_at" value={detail.request.updated_at} />
    </>
  );
}

// Order of recommendation (specification section 06): the first possible action is the next step,
// the others follow under "Oder stattdessen", rejecting comes last in red. Release, waiting and correction of the
// intake are one form in "Erstbearbeitung" since task-22-1 (IntakeForm).
const PRIMARY_ORDER = ["close", "createInvoice", "issueInvoice"] as const;
const ALTERNATIVE_ORDER = ["close", "createInvoice", "issueInvoice", "email", "reject"] as const;
export type ActionKey = (typeof ALTERNATIVE_ORDER)[number];

export function nextStepOf(can: ReturnType<typeof availableActions>): { primary: ActionKey | null; alternatives: ActionKey[] } {
  const primary = PRIMARY_ORDER.find((key) => can[key]) ?? null;
  return { primary, alternatives: ALTERNATIVE_ORDER.filter((key) => can[key] && key !== primary) };
}

// One action as a foldable form. Staff (task-22-1) find each action in its section; the technician keeps the list.
export function RequestAction({ detail, employee, kind }: { detail: RequestDetail; employee: Employee; kind: ActionKey }) {
  return actionRenderers(detail, employee, nextStepOf(availableActions(detail, employee)).primary)[kind]();
}

export function RequestActions({ detail, employee }: { detail: RequestDetail; employee: Employee }) {
  const can = availableActions(detail, employee);
  const { primary, alternatives } = nextStepOf(can);
  const render = actionRenderers(detail, employee, primary);

  return (
    <div className="action-list">
      {primary && render[primary]()}
      {alternatives.length > 0 && (
        <div className="rw-alternatives">
          <p className="rw-alternatives__label">{primary ? "Oder stattdessen" : "Mögliche Aktionen"}</p>
          {alternatives.map((key) => render[key]())}
        </div>
      )}
    </div>
  );
}

function actionRenderers(detail: RequestDetail, employee: Employee, primary: ActionKey | null): Record<ActionKey, () => ReactNode> {
  const r = detail.request;
  const openVisits = detail.visits.filter((visit) => OPEN_VISITS.includes(visit.status)).length;
  const subject = `Rückfrage zu Ihrer Serviceanfrage ${r.request_number}`;
  // Customer number only for linked requests (task-15-3); requests.customer_number is set only then
  const customerNote = r.customer_number ? `Ihre Kundennummer: ${r.customer_number} – bitte bei Rückfragen und Anrufen angeben.\n\n` : "";
  const body = `Guten Tag ${r.contact_name},\n\nvielen Dank für Ihre Anfrage ${r.request_number}. Für die Planung des Einsatzes benötigen wir noch folgende Angaben:\n\n- \n\n${customerNote}Mit freundlichen Grüßen\n${employee.displayName}\nRheinWerk Industrieservice`;
  // Open drafts (task-20-8): the form points there instead of starting a second one unnoticed
  const drafts = (detail.messages ?? []).filter((message) => message.status === "draft");
  // Only the next step has the primary (lime) button
  const variant = (key: ActionKey) => (key === primary ? "primary" : "secondary");
  const className = (key: ActionKey) => `action${key === primary ? " action--primary" : ""}${key === "reject" ? " action--danger" : ""}`;

  const render: Record<ActionKey, () => ReactNode> = {
    email: () => (
      <details key="email" className={className("email")}>
        <summary>Neue E-Mail an den Kunden</summary>
        <p className="section-note">Wird als Entwurf gespeichert und erscheint unten in der Liste. Dort lässt er sich bearbeiten, löschen oder senden.</p>
        {drafts.length > 0 && (
          <p className="rw-blocked">
            {drafts.length === 1 ? "Es gibt schon einen Entwurf" : `Es gibt schon ${drafts.length} Entwürfe`}: <a href={`#nachricht-${drafts[0].id}`}>Entwurf weiter bearbeiten</a>.
          </p>
        )}
        <SaveForm action={createDraft} submitLabel="Als Entwurf speichern" submitVariant="secondary">
          <Context detail={detail} />
          <div className="form-grid">
            <SelectField name="kind" label="Art" required defaultValue="clarification" options={[{ value: "clarification", label: "Rückfrage" }, { value: "other", label: "Sonstige Nachricht" }]} />
            <TextField name="to_address" label="Empfänger" type="email" required defaultValue={r.business_email} />
          </div>
          <TextField name="subject" label="Betreff" required defaultValue={subject} />
          <TextAreaField name="body_text" label="Text" required rows={8} defaultValue={body} />
        </SaveForm>
      </details>
    ),
    close: () => (
      <details key="close" className={className("close")} open={primary === "close" || undefined}>
        <summary>Anfrage abschließen</summary>
        {openVisits > 0 ? (
          <p className="rw-blocked">Noch offen: {openVisits === 1 ? "ein Einsatz" : `${openVisits} Einsätze`}. Abschließen ist erst möglich, wenn alle Einsätze beendet oder storniert sind.</p>
        ) : (
          <>
            <p className="section-note">Schließt die Arbeit an dieser Anfrage technisch ab; eine Freigabe durch die Leitung ist nicht nötig. Danach kann die Rechnung erstellt werden. Arbeitspositionen bleiben bis zur Ausstellung der Rechnung korrigierbar.</p>
            <SaveForm action={closeRequest} submitLabel="Anfrage abschließen" submitVariant={variant("close")}>
              <Context detail={detail} />
              <TextAreaField name="completion_summary" label="Abschlussbericht" required rows={4} defaultValue={[...detail.visits].reverse().find((visit) => visit.status === "completed")?.summary ?? ""} />
            </SaveForm>
          </>
        )}
      </details>
    ),
    createInvoice: () => (
      <details key="createInvoice" className={className("createInvoice")} open={primary === "createInvoice" || undefined}>
        <summary>Rechnung erstellen</summary>
        <p className="section-note">Legt einen Rechnungsentwurf aus den abrechenbaren Positionen an (geleistete Arbeit und Pauschalen, verbaute Teile). Der Entwurf ist eine Vorschau und hat noch keine Rechnungsnummer.</p>
        <SaveForm action={createInvoice} submitLabel="Rechnungsentwurf erstellen" submitVariant={variant("createInvoice")}>
          <Context detail={detail} />
        </SaveForm>
      </details>
    ),
    issueInvoice: () => detail.invoice && (
      <details key="issueInvoice" className={className("issueInvoice")} open={primary === "issueInvoice" || undefined}>
        <summary>Rechnung ausstellen</summary>
        {detail.invoiceItems.length === 0 ? (
          <p className="rw-blocked">Noch offen: abrechenbare Positionen. Bitte unter „Arbeit“ geleistete Arbeit oder verbaute Teile erfassen.</p>
        ) : (
          <p className="section-note">
            Vergibt die Rechnungsnummer und übernimmt den aktuellen Stand der Arbeitspositionen (Vorschau: {formatCurrency(detail.invoice.total, detail.invoice.currency)} brutto).
            Danach sind Rechnung und Positionen unveränderlich, und das PDF (Musterrechnung / Demodaten) steht bereit. Versendet wird nichts.
          </p>
        )}
        <SaveForm action={issueInvoice} submitLabel="Rechnung ausstellen" submitVariant={variant("issueInvoice")}>
          <Context detail={detail} />
          <HiddenField name="invoice_id" value={detail.invoice.id} />
        </SaveForm>
      </details>
    ),
    reject: () => (
      <details key="reject" className={className("reject")}>
        <summary>Anfrage ablehnen</summary>
        <p className="section-note">Nur vor Arbeitsbeginn möglich. Geplante Einsätze werden storniert. Der Kunde wird nicht automatisch benachrichtigt.</p>
        <SaveForm action={rejectRequest} submitLabel="Anfrage ablehnen" submitVariant="danger">
          <Context detail={detail} />
          <TextAreaField name="reason" label="Ablehnungsgrund" required rows={3} />
        </SaveForm>
      </details>
    ),
  };

  return render;
}

// Editing and queueing of a draft in the correspondence section
export function DraftActions({ detail, message }: { detail: RequestDetail; message: NonNullable<RequestDetail["messages"]>[number] }) {
  return (
    <div className="draft-actions">
      <SaveForm action={updateDraft} submitLabel="Entwurf speichern" submitVariant="secondary">
        <Context detail={detail} />
        <HiddenField name="message_id" value={message.id} />
        <TextField name="to_address" label="Empfänger" type="email" required defaultValue={message.to_address ?? ""} />
        <TextField name="subject" label="Betreff" required defaultValue={message.subject} />
        <TextAreaField name="body_text" label="Text" required rows={8} defaultValue={message.body_text} />
      </SaveForm>
      <div className="draft-actions__row">
        <SaveForm action={queueDraft} submitLabel="Senden">
          <Context detail={detail} />
          <HiddenField name="message_id" value={message.id} />
          <p className="section-note">Gibt den gespeicherten Stand für den Versand frei. Die E-Mail gilt als versendet, sobald die Integration den Versand bestätigt.</p>
        </SaveForm>
        <SaveForm action={deleteDraft} submitLabel="Entwurf löschen" submitVariant="danger">
          <Context detail={detail} />
          <HiddenField name="message_id" value={message.id} />
          <p className="section-note">Der Entwurf wird entfernt; im Verlauf bleibt ein Eintrag.</p>
        </SaveForm>
      </div>
    </div>
  );
}

// Classification and next intake status in the section "Erstbearbeitung" (task-22-1): replaces "Analyse korrigieren",
// "Prüfen und freigeben" and "Auf Kundenantwort warten" of the former next-step card for staff.
export function IntakeForm({ detail, employee }: { detail: RequestDetail; employee: Employee }) {
  const r = detail.request;
  const can = availableActions(detail, employee);
  const lastRun = [...(detail.automationRuns ?? [])].reverse().find((run) => run.status === "succeeded" && !run.corrected_at && ["intake_analysis", "reply_analysis"].includes(run.step));
  const statusOptions = [
    ...(can.complete ? [{ value: "processed", label: "Freigeben – weiter zur Einsatzplanung" }] : []),
    ...(can.await ? [{ value: "awaiting_customer", label: "Wartet auf Kunde" }] : []),
  ];
  return (
    <div className="intake-form">
      <h3>{statusOptions.length > 0 ? "Einstufung und Status" : "Einstufung korrigieren"}</h3>
      <SaveForm action={saveIntake} submitLabel="Speichern" submitVariant={can.complete ? "primary" : "secondary"}>
        <Context detail={detail} />
        <HiddenField name="current_priority" value={r.priority ?? ""} />
        <HiddenField name="current_service_kind" value={r.service_kind} />
        {lastRun && <HiddenField name="automation_run_id" value={lastRun.id} />}
        <div className="form-grid">
          <SelectField name="priority" label="Priorität" defaultValue={r.priority ?? ""} emptyLabel="Noch nicht bestimmt" options={priorityOptions} />
          <SelectField name="service_kind" label="Leistungsart" required defaultValue={r.service_kind} options={serviceOptions} />
          {statusOptions.length > 0 && (
            <SelectField name="status" label={`Status (aktuell: ${statusInfo("intake_status", r.intake_status).label})`} defaultValue="" emptyLabel="Unverändert" options={statusOptions} />
          )}
        </div>
        <TextAreaField name="note" label="Grund oder Notiz für den Verlauf" rows={2}
          hint={`Pflicht, wenn Priorität oder Leistungsart korrigiert werden${lastRun ? "; der letzte Automatisierungslauf wird dann als korrigiert markiert" : ""}. Bei der Freigabe gilt die gewählte Priorität ohne Korrektur.`} />
      </SaveForm>
    </div>
  );
}
