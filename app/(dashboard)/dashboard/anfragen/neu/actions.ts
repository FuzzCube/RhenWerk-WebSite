"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { databaseErrorMessage, formError, formValues, type FormState } from "@/lib/forms";
import { requestFieldErrors, requestFieldPayload } from "@/lib/request-fields";
import { createClient } from "@/lib/supabase/server";

// Request taken over the phone (task-11-4). The form carries a submission id created when the page was rendered,
// so a double click or a retry returns the same request (key phone:<submission id>). Rights, field checks and the
// dispatcher choice are repeated in create_phone_request. A customer chosen on the form links the request directly.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createPhoneRequest(_previous: FormState, formData: FormData): Promise<FormState> {
  const employee = await requireRole(["dispatcher", "manager", "admin"]);
  const values = formValues(formData);
  if (!UUID.test(values.submission_id ?? "")) return formError("Das Formular ist veraltet. Bitte die Seite neu laden.", values);
  const fieldErrors = requestFieldErrors(values);
  const dispatcher = employee.role === "dispatcher" ? "" : (values.dispatcher_id ?? "");
  if (dispatcher && !UUID.test(dispatcher)) fieldErrors.dispatcher_id = "Bitte einen Dispatcher wählen.";
  // Customer chosen from the suggestions of the customer number (task-15-4); checked again in the database
  const customer = values.customer_id ?? "";
  if (customer && !UUID.test(customer)) fieldErrors.customer_number = "Bitte den Kunden erneut aus den Vorschlägen wählen.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_phone_request", {
    submission_id: values.submission_id,
    fields: requestFieldPayload(values),
    send_receipt: values.send_receipt === "on",
    ...(dispatcher ? { assigned_dispatcher_id: dispatcher } : {}),
    ...(customer ? { customer_id: customer } : {}),
  });
  if (error || !data) return formError(databaseErrorMessage(error), values);
  redirect(`/dashboard/anfragen/${data.id}`);
}
