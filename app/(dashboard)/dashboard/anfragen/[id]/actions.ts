"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { berlinToInstant, dayKeyOf, isDayKey } from "@/lib/berlin-time";
import { databaseErrorMessage, formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Review actions of the request page (task-5-2). Every action calls a controlled database operation
// (phase 2) with the user's rights; role, assignment, state transition and expected_version are checked there.
// No action sends e-mails: messages end as draft or queue entry; only the integration confirms sending.
type Enums = Database["public"]["Enums"];
const STAFF = ["dispatcher", "manager", "admin"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITIES: readonly string[] = ["low", "normal", "high", "critical"];
const SERVICE_KINDS: readonly string[] = ["inspection", "scheduled_maintenance", "diagnosis_repair"];
const MESSAGE_KINDS: readonly string[] = ["clarification", "other"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Context = { values: Record<string, string>; id: string; version: number };

// Common input: request id and the version the user saw
function context(formData: FormData): Context | null {
  const values = formValues(formData);
  const version = Number.parseInt(values.version ?? "", 10);
  if (!UUID.test(values.request_id ?? "") || !Number.isInteger(version)) return null;
  return { values, id: values.request_id, version };
}

async function run(values: Record<string, string>, success: string, call: () => PromiseLike<{ error: { code?: string; message?: string } | null }>): Promise<FormState> {
  const { error } = await call();
  if (error) return formError(databaseErrorMessage(error), values);
  refresh();
  return formSuccess(success, values);
}

const invalid = (values: Record<string, string>) => formError("Ungültige Anfrage. Bitte die Seite neu laden.", values);

export async function completeIntake(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  if (!PRIORITIES.includes(values.priority ?? "")) return formError("Bitte die Priorität festlegen.", values, { priority: "Pflichtangabe für den Abschluss." });
  const supabase = await createClient();
  return run(values, "Erstbearbeitung abgeschlossen. Die Anfrage steht jetzt zur Einsatzplanung bereit.", () =>
    supabase.rpc("complete_intake", { request_id: input.id, expected_version: input.version, priority: values.priority as Enums["request_priority"], note: values.note?.trim() || undefined }));
}

export async function correctAnalysis(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  const fieldErrors: Record<string, string> = {};
  const priority = values.priority && values.priority !== values.current_priority ? values.priority : "";
  const serviceKind = values.service_kind && values.service_kind !== values.current_service_kind ? values.service_kind : "";
  if (priority && !PRIORITIES.includes(priority)) fieldErrors.priority = "Ungültige Priorität.";
  if (serviceKind && !SERVICE_KINDS.includes(serviceKind)) fieldErrors.service_kind = "Ungültige Leistungsart.";
  if (!priority && !serviceKind) fieldErrors.priority = "Priorität oder Leistungsart ändern.";
  if (!values.reason?.trim()) fieldErrors.reason = "Bitte den Grund der Korrektur angeben.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const runId = UUID.test(values.automation_run_id ?? "") ? values.automation_run_id : undefined;
  const supabase = await createClient();
  return run(values, "Korrektur gespeichert.", () =>
    supabase.rpc("correct_analysis", {
      request_id: input.id,
      expected_version: input.version,
      reason: values.reason.trim(),
      priority: (priority || undefined) as Enums["request_priority"] | undefined,
      service_kind: (serviceKind || undefined) as Enums["service_kind"] | undefined,
      automation_run_id: runId,
    }));
}

export async function markAwaitingCustomer(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const supabase = await createClient();
  return run(input.values, "Status „Wartet auf Kunde“ gesetzt.", () =>
    supabase.rpc("mark_awaiting_customer", { request_id: input.id, expected_version: input.version, note: input.values.note?.trim() || undefined }));
}

export async function rejectRequest(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  if (!values.reason?.trim()) return formError("Bitte den Ablehnungsgrund angeben.", values, { reason: "Pflichtangabe." });
  const supabase = await createClient();
  return run(values, "Anfrage abgelehnt.", () =>
    supabase.rpc("reject_request", { request_id: input.id, expected_version: input.version, reason: values.reason.trim() }));
}

function emailErrors(values: Record<string, string>): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  if (!EMAIL.test(values.to_address?.trim() ?? "")) fieldErrors.to_address = "Bitte eine gültige E-Mail-Adresse angeben.";
  if (!values.subject?.trim()) fieldErrors.subject = "Bitte einen Betreff angeben.";
  if (!values.body_text?.trim()) fieldErrors.body_text = "Bitte einen Text angeben.";
  return fieldErrors;
}

export async function createDraft(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  const fieldErrors = emailErrors(values);
  if (!MESSAGE_KINDS.includes(values.kind ?? "")) fieldErrors.kind = "Bitte die Art wählen.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  return run(values, "Entwurf gespeichert (nicht versendet).", () =>
    supabase.rpc("create_message_draft", {
      request_id: input.id,
      expected_version: input.version,
      kind: values.kind as Enums["message_kind"],
      to_address: values.to_address.trim(),
      subject: values.subject.trim(),
      body_text: values.body_text,
    }));
}

export async function updateDraft(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input || !UUID.test(input.values.message_id ?? "")) return invalid(formValues(formData));
  const { values } = input;
  const fieldErrors = emailErrors(values);
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  return run(values, "Entwurf aktualisiert (nicht versendet).", () =>
    supabase.rpc("update_message_draft", {
      message_id: values.message_id,
      expected_version: input.version,
      to_address: values.to_address.trim(),
      subject: values.subject.trim(),
      body_text: values.body_text,
    }));
}

export async function queueDraft(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input || !UUID.test(input.values.message_id ?? "")) return invalid(formValues(formData));
  const supabase = await createClient();
  return run(input.values, "In die Warteschlange gestellt – noch nicht versendet.", () =>
    supabase.rpc("queue_message", { message_id: input.values.message_id, expected_version: input.version }));
}

// Completion and invoicing (task-6-3): current technician, manager or admin, no manager approval.
// close_request checks open visits, a completed visit and the report; issue_invoice rebuilds the items.
const BILLING = ["technician", "manager", "admin"] as const;

export async function closeRequest(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(BILLING);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  if (!values.completion_summary?.trim()) return formError("Bitte den Abschlussbericht angeben.", values, { completion_summary: "Pflichtangabe für den Abschluss." });
  const supabase = await createClient();
  return run(values, "Anfrage abgeschlossen. Die Rechnung kann jetzt erstellt werden.", () =>
    supabase.rpc("close_request", { request_id: input.id, expected_version: input.version, completion_summary: values.completion_summary.trim() }));
}

export async function createInvoice(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(BILLING);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const supabase = await createClient();
  return run(input.values, "Rechnungsentwurf erstellt. Bitte Positionen prüfen und ausstellen.", () =>
    supabase.rpc("create_invoice", { request_id: input.id, expected_version: input.version }));
}

export async function issueInvoice(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(BILLING);
  const input = context(formData);
  if (!input || !UUID.test(input.values.invoice_id ?? "")) return invalid(formValues(formData));
  const supabase = await createClient();
  return run(input.values, "Rechnung ausgestellt. Das PDF steht zum Download bereit.", () =>
    supabase.rpc("issue_invoice", { invoice_id: input.values.invoice_id, expected_version: input.version }));
}

// Payment of an issued invoice (task-10-3, user decision: on the request page and in the invoice list).
// The payment date is a calendar day in Berlin: today means now, an earlier day its last minute.
// The database checks the role (manager, admin), the state and that the date lies between issue and now.
export async function recordPayment(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["manager", "admin"]);
  const input = context(formData);
  if (!input || !UUID.test(input.values.invoice_id ?? "")) return invalid(formValues(formData));
  const day = input.values.paid_on ?? "";
  if (!isDayKey(day)) return formError("Bitte das Zahlungsdatum angeben.", input.values, { paid_on: "Datum im Format TT.MM.JJJJ." });
  const today = dayKeyOf(new Date());
  if (day > today) return formError("Das Zahlungsdatum liegt in der Zukunft.", input.values, { paid_on: "Höchstens heute." });
  const paidAt = day === today ? undefined : berlinToInstant(day, "23:59").toISOString();
  const supabase = await createClient();
  return run(input.values, "Zahlung erfasst.", () =>
    supabase.rpc("record_payment", { invoice_id: input.values.invoice_id, expected_version: input.version, ...(paidAt ? { paid_at: paidAt } : {}) }));
}

// Payment reminders (task-10-2): send the next stage now, pause or resume per invoice (manager, admin).
// The database checks role, open and overdue invoice, pause and the next stage.
async function reminderInput(formData: FormData) {
  await requireRole(["manager", "admin"]);
  const input = context(formData);
  return input && UUID.test(input.values.invoice_id ?? "") ? input : null;
}

export async function sendPaymentReminder(_previous: FormState, formData: FormData): Promise<FormState> {
  const input = await reminderInput(formData);
  if (!input) return invalid(formValues(formData));
  const supabase = await createClient();
  return run(input.values, "Erinnerung erstellt. Sie wird mit dem nächsten Versandlauf verschickt.", () =>
    supabase.rpc("send_payment_reminder", { invoice_id: input.values.invoice_id, expected_version: input.version }));
}

export async function pausePaymentReminders(_previous: FormState, formData: FormData): Promise<FormState> {
  const input = await reminderInput(formData);
  if (!input) return invalid(formValues(formData));
  const reason = input.values.reason?.trim() ?? "";
  if (!reason) return formError("Bitte einen Grund angeben.", input.values, { reason: "Pflichtangabe, z. B. Ratenzahlung vereinbart." });
  const supabase = await createClient();
  return run(input.values, "Erinnerungen ausgesetzt.", () =>
    supabase.rpc("pause_payment_reminders", { invoice_id: input.values.invoice_id, expected_version: input.version, reason }));
}

export async function resumePaymentReminders(_previous: FormState, formData: FormData): Promise<FormState> {
  const input = await reminderInput(formData);
  if (!input) return invalid(formValues(formData));
  const supabase = await createClient();
  return run(input.values, "Erinnerungen fortgesetzt.", () =>
    supabase.rpc("resume_payment_reminders", { invoice_id: input.values.invoice_id, expected_version: input.version }));
}

// Window hold of the phone assistant (task-13-3): confirm plans the visit in the held window (schedule_visit with all
// checks) and queues a confirmation e-mail; reject needs a reason and may offer an alternative to the customer
export async function confirmHold(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const ctx = context(formData);
  if (!ctx || !UUID.test(ctx.values.hold_id ?? "")) return invalid(formValues(formData));
  const supabase = await createClient();
  // One click (task-19-3): with a priority the open intake is completed first, then the hold is confirmed
  let version = ctx.version;
  if (ctx.values.priority) {
    if (!PRIORITIES.includes(ctx.values.priority)) return formError("Bitte die Priorität festlegen.", ctx.values, { priority: "Pflichtangabe für den Abschluss." });
    const { data, error } = await supabase.rpc("complete_intake", { request_id: ctx.id, expected_version: version, priority: ctx.values.priority as Enums["request_priority"] });
    if (error || !data) return formError(databaseErrorMessage(error ?? {}), ctx.values);
    version = data.version;
  }
  return run(ctx.values, "Termin bestätigt. Der Einsatz ist eingeplant, die Bestätigung an den Kunden steht in der Warteschlange.", () =>
    supabase.rpc("confirm_visit_hold", { hold_id: ctx.values.hold_id, expected_version: version }));
}

export async function rejectHold(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const values = formValues(formData);
  if (!UUID.test(values.hold_id ?? "")) return invalid(values);
  const reason = (values.reason ?? "").trim();
  if (!reason) return formError("Bitte einen Grund angeben.", values, { reason: "Pflichtangabe." });
  const supabase = await createClient();
  return run(values, "Vormerkung abgelehnt. Die Nachricht an den Kunden steht in der Warteschlange.", () =>
    supabase.rpc("reject_visit_hold", { hold_id: values.hold_id, reason, alternative: (values.alternative ?? "").trim() || undefined }));
}

// "Neuen Kunden anlegen" (task-14-2): customer from the request data, linked in the same step
export async function createCustomerFromRequest(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const supabase = await createClient();
  return run(input.values, "Kunde angelegt und verknüpft.", () =>
    supabase.rpc("create_customer_from_request", { request_id: input.id, expected_version: input.version }));
}

// Link to the customer master data (task-13-10), e.g. to correct the phone assistant; empty number removes the link.
// copy_data takes company, customer number, address of the site and the stored e-mail into the request.
export async function linkCustomer(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  const number = values.customer_number?.trim() ?? "";
  if (number && !/^K?[-\s]?\d{4,}$/i.test(number)) return formError("Bitte die markierten Felder prüfen.", values, { customer_number: "Format K-12345." });
  if (values.site_id && !UUID.test(values.site_id)) return invalid(values);
  const supabase = await createClient();
  return run(values, number ? "Mit dem Kunden verknüpft." : "Verknüpfung entfernt.", () =>
    supabase.rpc("link_request_customer", { request_id: input.id, expected_version: input.version, customer_number: number, site_id: values.site_id || undefined, copy_data: values.copy_data === "on" }));
}
