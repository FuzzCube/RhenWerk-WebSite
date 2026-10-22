import { closeRequest, completeIntake, correctAnalysis, createDraft, createInvoice, issueInvoice, markAwaitingCustomer, queueDraft, rejectRequest, updateDraft } from "@/app/(dashboard)/dashboard/anfragen/[id]/actions";
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
    </>
  );
}

// Order of recommendation (specification section 06): the first possible action is the next step,
// the others follow under "Oder stattdessen", rejecting comes last in red.
const PRIMARY_ORDER = ["complete", "close", "createInvoice", "issueInvoice"] as const;
const ALTERNATIVE_ORDER = ["complete", "close", "createInvoice", "issueInvoice", "email", "await", "correct", "reject"] as const;
type ActionKey = (typeof ALTERNATIVE_ORDER)[number];

export function nextStepOf(can: ReturnType<typeof availableActions>): { primary: ActionKey | null; alternatives: ActionKey[] } {
  const primary = PRIMARY_ORDER.find((key) => can[key]) ?? null;
  return { primary, alternatives: ALTERNATIVE_ORDER.filter((key) => can[key] && key !== primary) };
}

export function RequestActions({ detail, employee }: { detail: RequestDetail; employee: Employee }) {
  const r = detail.request;
  const can = availableActions(detail, employee);
  const { primary, alternatives } = nextStepOf(can);
  const openVisits = detail.visits.filter((visit) => OPEN_VISITS.includes(visit.status)).length;
  const lastRun = [...(detail.automationRuns ?? [])].reverse().find((run) => run.status === "succeeded" && !run.corrected_at && ["intake_analysis", "reply_analysis"].includes(run.step));
  const subject = `Rückfrage zu Ihrer Serviceanfrage ${r.request_number}`;
  // Customer number only for linked requests (task-15-3); requests.customer_number is set only then
  const customerNote = r.customer_number ? `Ihre Kundennummer: ${r.customer_number} – bitte bei Rückfragen und Anrufen angeben.\n\n` : "";
  const body = `Guten Tag ${r.contact_name},\n\nvielen Dank für Ihre Anfrage ${r.request_number}. Für die Planung des Einsatzes benötigen wir noch folgende Angaben:\n\n- \n\n${customerNote}Mit freundlichen Grüßen\n${employee.displayName}\nRheinWerk Industrieservice`;
  // Only the next step has the primary (lime) button
  const variant = (key: ActionKey) => (key === primary ? "primary" : "secondary");
  const className = (key: ActionKey) => `action${key === primary ? " action--primary" : ""}${key === "reject" ? " action--danger" : ""}`;

  const render: Record<ActionKey, () => ReactNode> = {
    complete: () => (
      <details key="complete" className={className("complete")} open={primary === "complete" || undefined}>
        <summary>Prüfen und freigeben</summary>
        <p className="section-note">Schließt die Erstbearbeitung ab und öffnet die Einsatzplanung mit dieser Anfrage.</p>
        <SaveForm action={completeIntake} submitLabel="Erstbearbeitung abschließen" submitVariant={variant("complete")}>
          <Context detail={detail} />
          <HiddenField name="seen_at" value={r.updated_at} />
          <div className="form-grid">
            <SelectField name="priority" label="Priorität" required defaultValue={r.priority ?? ""} options={priorityOptions} />
          </div>
          <TextAreaField name="note" label="Notiz für den Verlauf" rows={2} />
        </SaveForm>
      </details>
    ),
    correct: () => (
      <details key="correct" className={className("correct")}>
        <summary>Analyse korrigieren</summary>
        <p className="section-note">
          Für falsche automatische oder frühere Einstufungen. Die Korrektur wird im Verlauf festgehalten
          {lastRun ? " und der letzte Automatisierungslauf als korrigiert markiert (zählt nicht als Zeitersparnis)" : ""}.
        </p>
        <SaveForm action={correctAnalysis} submitLabel="Korrektur speichern" submitVariant="secondary">
          <Context detail={detail} />
          <HiddenField name="current_priority" value={r.priority ?? ""} />
          <HiddenField name="current_service_kind" value={r.service_kind} />
          {lastRun && <HiddenField name="automation_run_id" value={lastRun.id} />}
          <div className="form-grid">
            <SelectField name="priority" label={`Priorität (aktuell: ${r.priority ? statusInfo("request_priority", r.priority).label : "nicht bestimmt"})`} defaultValue={r.priority ?? ""} options={priorityOptions} />
            <SelectField name="service_kind" label="Leistungsart" required defaultValue={r.service_kind} options={serviceOptions} />
          </div>
          <TextAreaField name="reason" label="Grund der Korrektur" required rows={2} />
        </SaveForm>
      </details>
    ),
    email: () => (
      <details key="email" className={className("email")}>
        <summary>E-Mail an Kunden vorbereiten</summary>
        <p className="section-note">Erstellt einen Entwurf. Versendet wird nichts: Erst nach „In Warteschlange stellen“ unter Korrespondenz übernimmt die spätere Integration den Versand.</p>
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
    await: () => (
      <details key="await" className={className("await")}>
        <summary>Auf Kundenantwort warten</summary>
        <p className="section-note">Setzt die Erstbearbeitung auf „Wartet auf Kunde“, z. B. nachdem eine Rückfrage in die Warteschlange gestellt wurde.</p>
        <SaveForm action={markAwaitingCustomer} submitLabel="Status setzen" submitVariant="secondary">
          <Context detail={detail} />
          <TextAreaField name="note" label="Notiz für den Verlauf" rows={2} />
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
      <SaveForm action={queueDraft} submitLabel="In Warteschlange stellen">
        <Context detail={detail} />
        <HiddenField name="message_id" value={message.id} />
        <p className="section-note">Gibt den Entwurf für den Versand frei. Die Nachricht gilt erst als versendet, wenn die Integration den Versand bestätigt.</p>
      </SaveForm>
    </div>
  );
}
