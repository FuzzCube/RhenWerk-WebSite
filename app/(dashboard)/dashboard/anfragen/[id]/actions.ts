"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
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

type RpcResult<T = unknown> = { data: T | null; error: { code?: string; message?: string } | null };
type Client = Awaited<ReturnType<typeof createClient>>;

async function run(values: Record<string, string>, success: string, call: () => PromiseLike<{ error: { code?: string; message?: string } | null }>): Promise<FormState> {
  const { error } = await call();
  if (error) return formError(databaseErrorMessage(error), values);
  refresh();
  return formSuccess(success, values);
}

// task-20-4, for every action since task-20-8: sending an e-mail in the background (receipt, confirmation) changes the
// request (version) a few seconds later. If only such e-mail events happened since the page was loaded (seen_at = its
// updated_at), nothing the person decided on has changed: repeat with the current version instead of a conflict.
const MAIL_EVENTS: readonly string[] = ["message_queued", "message_sent"];

async function withCurrentVersion<T>(supabase: Client, input: Context, call: (version: number) => PromiseLike<RpcResult<T>>): Promise<RpcResult<T>> {
  const result = await call(input.version);
  if (result.error?.code !== "RW409" || !input.values.seen_at) return result;
  const [{ data: current }, { data: events }] = await Promise.all([
    supabase.from("requests").select("version").eq("id", input.id).single(),
    supabase.from("request_events").select("actor_type, event_type").eq("request_id", input.id).gt("created_at", input.values.seen_at),
  ]);
  // At least one e-mail event, nothing else, and no more version steps than such events (a change without an event,
  // e.g. edited data, still counts as a conflict)
  const list = events ?? [];
  const mailOnly = list.length > 0 && list.every((event) => event.actor_type === "automation" && MAIL_EVENTS.includes(event.event_type));
  return current && mailOnly && current.version > input.version && current.version - input.version <= list.length ? call(current.version) : result;
}

// Action on the request with its version: repeated once when only e-mails were sent meanwhile
async function runVersioned(supabase: Client, input: Context, success: string, call: (version: number) => PromiseLike<RpcResult>): Promise<FormState> {
  const { error } = await withCurrentVersion(supabase, input, call);
  if (error) return formError(databaseErrorMessage(error), input.values);
  refresh();
  return formSuccess(success, input.values);
}

const invalid = (values: Record<string, string>) => formError("Ungültige Anfrage. Bitte die Seite neu laden.", values);

// task-22-1: one form in "Erstbearbeitung" for classification and, while the intake is open, the next status.
// A changed service kind (and a changed priority without release) is a correction with a reason; the release takes
// the priority itself, as before. The status follows the correction with the version the correction returned.
const INTAKE_TARGETS: readonly string[] = ["processed", "awaiting_customer"];

export async function saveIntake(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  const target = values.status ?? "";
  const release = target === "processed";
  const priority = values.priority && values.priority !== values.current_priority ? values.priority : "";
  const serviceKind = values.service_kind && values.service_kind !== values.current_service_kind ? values.service_kind : "";
  const correctPriority = priority && !release ? priority : "";
  const correction = Boolean(correctPriority || serviceKind);
  const fieldErrors: Record<string, string> = {};
  if (values.priority && !PRIORITIES.includes(values.priority)) fieldErrors.priority = "Ungültige Priorität.";
  if (serviceKind && !SERVICE_KINDS.includes(serviceKind)) fieldErrors.service_kind = "Ungültige Leistungsart.";
  if (target && !INTAKE_TARGETS.includes(target)) fieldErrors.status = "Ungültiger Status.";
  if (release && !PRIORITIES.includes(values.priority ?? "")) fieldErrors.priority = "Pflichtangabe für die Freigabe.";
  if (!priority && !serviceKind && !target) fieldErrors.priority = "Priorität, Leistungsart oder Status ändern.";
  if (correction && !values.note?.trim()) fieldErrors.note = "Bitte den Grund der Korrektur angeben.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  const note = values.note?.trim() || undefined;
  let version = input.version;
  if (correction) {
    const runId = UUID.test(values.automation_run_id ?? "") ? values.automation_run_id : undefined;
    const { data, error } = await withCurrentVersion(supabase, input, (current) =>
      supabase.rpc("correct_analysis", {
        request_id: input.id,
        expected_version: current,
        reason: note ?? "",
        priority: (correctPriority || undefined) as Enums["request_priority"] | undefined,
        service_kind: (serviceKind || undefined) as Enums["service_kind"] | undefined,
        automation_run_id: runId,
      }));
    if (error || !data) return formError(databaseErrorMessage(error ?? {}), values);
    version = data.version;
  }
  const next = { ...input, version };
  if (release) {
    const { error } = await withCurrentVersion(supabase, next, (current) =>
      supabase.rpc("complete_intake", { request_id: input.id, expected_version: current, priority: values.priority as Enums["request_priority"], note }));
    if (error) return formError(`${correction ? "Korrektur gespeichert, aber " : ""}${databaseErrorMessage(error)}`, values);
    // Next step is planning (user request 22.10.2026): straight to the board, where an open hold is the preselected slot
    redirect(`/dashboard/planung?anfrage=${input.id}`);
  }
  if (target === "awaiting_customer") {
    const { error } = await withCurrentVersion(supabase, next, (current) =>
      supabase.rpc("mark_awaiting_customer", { request_id: input.id, expected_version: current, note }));
    if (error) return formError(`${correction ? "Korrektur gespeichert, aber " : ""}${databaseErrorMessage(error)}`, values);
  }
  refresh();
  return formSuccess(correction && target ? "Korrektur und Status gespeichert." : correction ? "Korrektur gespeichert." : "Status „Wartet auf Kunde“ gesetzt.", values);
}

export async function rejectRequest(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const { values } = input;
  if (!values.reason?.trim()) return formError("Bitte den Ablehnungsgrund angeben.", values, { reason: "Pflichtangabe." });
  const supabase = await createClient();
  return runVersioned(supabase, input, "Anfrage abgelehnt.", (version) =>
    supabase.rpc("reject_request", { request_id: input.id, expected_version: version, reason: values.reason.trim() }));
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
  const { data: draft, error } = await withCurrentVersion(supabase, input, (version) =>
    supabase.rpc("create_message_draft", {
      request_id: input.id,
      expected_version: version,
      kind: values.kind as Enums["message_kind"],
      to_address: values.to_address.trim(),
      subject: values.subject.trim(),
      body_text: values.body_text,
    }));
  if (error) return formError(databaseErrorMessage(error), values);
  // task-20-8: the draft lives in the correspondence; open it there with the text, the form starts from the template
  redirect(`/dashboard/anfragen/${input.id}?entwurf=${draft?.id ?? ""}#nachricht-${draft?.id ?? ""}`);
}

export async function updateDraft(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input || !UUID.test(input.values.message_id ?? "")) return invalid(formValues(formData));
  const { values } = input;
  const fieldErrors = emailErrors(values);
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  return runVersioned(supabase, input, "Entwurf aktualisiert (nicht versendet).", (version) =>
    supabase.rpc("update_message_draft", {
      message_id: values.message_id,
      expected_version: version,
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
  return runVersioned(supabase, input, "In die Warteschlange gestellt – noch nicht versendet.", (version) =>
    supabase.rpc("queue_message", { message_id: input.values.message_id, expected_version: version }));
}

// task-22-1: discard a draft in the correspondence; queued and sent messages stay
export async function deleteDraft(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input || !UUID.test(input.values.message_id ?? "")) return invalid(formValues(formData));
  const supabase = await createClient();
  return runVersioned(supabase, input, "Entwurf gelöscht.", (version) =>
    supabase.rpc("delete_message_draft", { message_id: input.values.message_id, expected_version: version }));
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
  return runVersioned(supabase, input, "Anfrage abgeschlossen. Die Rechnung kann jetzt erstellt werden.", (version) =>
    supabase.rpc("close_request", { request_id: input.id, expected_version: version, completion_summary: values.completion_summary.trim() }));
}

export async function createInvoice(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(BILLING);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const supabase = await createClient();
  return runVersioned(supabase, input, "Rechnungsentwurf erstellt. Bitte Positionen prüfen und ausstellen.", (version) =>
    supabase.rpc("create_invoice", { request_id: input.id, expected_version: version }));
}

export async function issueInvoice(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(BILLING);
  const input = context(formData);
  if (!input || !UUID.test(input.values.invoice_id ?? "")) return invalid(formValues(formData));
  const supabase = await createClient();
  return runVersioned(supabase, input, "Rechnung ausgestellt. Das PDF steht zum Download bereit.", (version) =>
    supabase.rpc("issue_invoice", { invoice_id: input.values.invoice_id, expected_version: version }));
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
  return runVersioned(supabase, input, "Zahlung erfasst.", (version) =>
    supabase.rpc("record_payment", { invoice_id: input.values.invoice_id, expected_version: version, ...(paidAt ? { paid_at: paidAt } : {}) }));
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
  return runVersioned(supabase, input, "Erinnerung erstellt. Sie wird mit dem nächsten Versandlauf verschickt.", (version) =>
    supabase.rpc("send_payment_reminder", { invoice_id: input.values.invoice_id, expected_version: version }));
}

export async function pausePaymentReminders(_previous: FormState, formData: FormData): Promise<FormState> {
  const input = await reminderInput(formData);
  if (!input) return invalid(formValues(formData));
  const reason = input.values.reason?.trim() ?? "";
  if (!reason) return formError("Bitte einen Grund angeben.", input.values, { reason: "Pflichtangabe, z. B. Ratenzahlung vereinbart." });
  const supabase = await createClient();
  return runVersioned(supabase, input, "Erinnerungen ausgesetzt.", (version) =>
    supabase.rpc("pause_payment_reminders", { invoice_id: input.values.invoice_id, expected_version: version, reason }));
}

export async function resumePaymentReminders(_previous: FormState, formData: FormData): Promise<FormState> {
  const input = await reminderInput(formData);
  if (!input) return invalid(formValues(formData));
  const supabase = await createClient();
  return runVersioned(supabase, input, "Erinnerungen fortgesetzt.", (version) =>
    supabase.rpc("resume_payment_reminders", { invoice_id: input.values.invoice_id, expected_version: version }));
}

// Window hold of the phone assistant (task-13-3): confirm plans the visit in the held window (schedule_visit with all
// checks) and queues a confirmation e-mail; reject needs a reason and may offer an alternative to the customer
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

// task-23-2 (replaces "Als gelesen markieren", task-20-14): opening the request marks the customer's e-mails as read;
// clears the marks on the planning board, in the request list and in the navigation. No refresh: the open page keeps
// showing what was new, the dashboard poll picks up the change.
export async function markOpenedMessagesRead(requestId: string): Promise<void> {
  await requireRole(STAFF);
  if (!UUID.test(requestId)) return;
  const supabase = await createClient();
  await supabase.rpc("mark_request_messages_read", { request_id: requestId });
}

// "Neuen Kunden anlegen" (task-14-2): customer from the request data, linked in the same step
export async function createCustomerFromRequest(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const input = context(formData);
  if (!input) return invalid(formValues(formData));
  const supabase = await createClient();
  return runVersioned(supabase, input, "Kunde angelegt und verknüpft.", (version) =>
    supabase.rpc("create_customer_from_request", { request_id: input.id, expected_version: version }));
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
  return runVersioned(supabase, input, number ? "Mit dem Kunden verknüpft." : "Verknüpfung entfernt.", (version) =>
    supabase.rpc("link_request_customer", { request_id: input.id, expected_version: version, customer_number: number, site_id: values.site_id || undefined, copy_data: values.copy_data === "on" }));
}
