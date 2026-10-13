"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { databaseErrorMessage, formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

// Inbox actions (task-10-5). Both call a controlled database operation with the user's rights; access to the
// message (inbox owner, manager, admin) and to the target request is checked there.
const STAFF = ["dispatcher", "manager", "admin"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUIRED: Record<string, string> = {
  company_name: "Firma",
  contact_name: "Ansprechperson",
  business_email: "E-Mail-Adresse",
  phone_number: "Telefon",
  street_house_number: "Straße und Hausnummer",
  postal_code: "PLZ",
  city: "Ort",
  equipment_kind: "Anlagenart",
  service_kind: "Leistungsart",
  requested_visit_date: "Wunschtermin",
  customer_urgency: "Dringlichkeit",
  safety_risk: "Sicherheitsgefahr",
  description: "Beschreibung",
};

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
  const fieldErrors: Record<string, string> = {};
  for (const name of Object.keys(REQUIRED)) if (!values[name]?.trim()) fieldErrors[name] = "Pflichtangabe.";
  if (values.business_email && !EMAIL.test(values.business_email.trim())) fieldErrors.business_email = "Bitte eine gültige E-Mail-Adresse angeben.";
  if (values.postal_code && !/^\d{5}$/.test(values.postal_code.trim())) fieldErrors.postal_code = "Fünfstellige PLZ.";
  if (values.description && values.description.trim().length < 10) fieldErrors.description = "Mindestens 10 Zeichen.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);

  const fields = Object.fromEntries(
    [...Object.keys(REQUIRED), "customer_number", "manufacturer", "model_type"].map((name) => [name, values[name]?.trim() ?? ""]),
  );
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_request_from_message", { message_id: values.message_id, fields });
  if (error || !data) return formError(databaseErrorMessage(error), values);
  redirect(`/dashboard/anfragen/${data.id}`);
}
