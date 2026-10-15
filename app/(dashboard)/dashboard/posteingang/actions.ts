"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { databaseErrorMessage, formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import { requestFieldErrors, requestFieldPayload } from "@/lib/request-fields";
import { createClient } from "@/lib/supabase/server";

// Inbox actions (task-10-5). Both call a controlled database operation with the user's rights; access to the
// message (inbox owner, manager, admin) and to the target request is checked there.
const STAFF = ["dispatcher", "manager", "admin"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Assign to an existing request: the select carries "<request id>:<version>" of the request the user saw
export async function linkMessage(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const values = formValues(formData);
  const [requestId, version] = (values.target ?? "").split(":");
  if (!UUID.test(values.message_id ?? "")) return formError("Ungültige Nachricht. Bitte die Seite neu laden.", values);
  if (!UUID.test(requestId ?? "") || !Number.isInteger(Number(version))) return formError("Bitte eine Anfrage wählen.", values, { target: "Pflichtangabe." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_message", { message_id: values.message_id, request_id: requestId, expected_version: Number(version) });
  if (error) return formError(databaseErrorMessage(error), values);
  refresh();
  return formSuccess("Zugeordnet. Die E-Mail steht jetzt unter Korrespondenz der Anfrage.", values);
}

// New request from the e-mail; a repeated submit returns the same request (source key email:<message id>)
export async function createRequestFromMessage(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const values = formValues(formData);
  if (!UUID.test(values.message_id ?? "")) return formError("Ungültige Nachricht. Bitte die Seite neu laden.", values);
  const fieldErrors = requestFieldErrors(values);
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const fields = requestFieldPayload(values);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_request_from_message", { message_id: values.message_id, fields });
  if (error || !data) return formError(databaseErrorMessage(error), values);
  // Also re-render the layout, so the inbox counter in the navigation is current
  refresh();
  redirect(`/dashboard/anfragen/${data.id}`);
}

const ARCHIVE_REASONS = ["advertising", "supplier", "application", "other"];

// Archive an e-mail that does not concern an order (task-10-10); back to the open inbox with an undo link
export async function archiveMessage(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const values = formValues(formData);
  if (!UUID.test(values.message_id ?? "")) return formError("Ungültige Nachricht. Bitte die Seite neu laden.", values);
  if (!ARCHIVE_REASONS.includes(values.reason ?? "")) return formError("Bitte einen Grund wählen.", values, { reason: "Pflichtangabe." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_message", { message_id: values.message_id, reason: values.reason });
  if (error) return formError(databaseErrorMessage(error), values);
  // Also re-render the layout, so the inbox counter in the navigation is current
  refresh();
  redirect(`/dashboard/posteingang?archiviert=${values.message_id}`);
}

// Bring an archived e-mail back into the open inbox and show it
export async function restoreMessage(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const values = formValues(formData);
  if (!UUID.test(values.message_id ?? "")) return formError("Ungültige Nachricht. Bitte die Seite neu laden.", values);
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_message", { message_id: values.message_id });
  if (error) return formError(databaseErrorMessage(error), values);
  // Also re-render the layout, so the inbox counter in the navigation is current
  refresh();
  redirect(`/dashboard/posteingang?nachricht=${values.message_id}#nachricht`);
}
