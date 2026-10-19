"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { databaseErrorMessage, formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

// Customer master data (task-13-10): dispatcher, manager and admin create and correct customers and sites, e.g.
// after a mistake of the phone assistant. Every change goes through a controlled operation with version check.
const STAFF = ["dispatcher", "manager", "admin"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;
const PLZ = /^\d{5}$/;

const invalid = (values: Record<string, string>) => formError("Ungültige Anfrage. Bitte die Seite neu laden.", values);
const text = (value: string | undefined) => value?.trim() || undefined;

function siteErrors(values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.street_house_number?.trim()) errors.street_house_number = "Bitte Straße und Hausnummer angeben.";
  if (!PLZ.test(values.postal_code?.trim() ?? "")) errors.postal_code = "Fünf Ziffern.";
  if (!values.city?.trim()) errors.city = "Bitte den Ort angeben.";
  return errors;
}

function customerErrors(values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.company_name?.trim()) errors.company_name = "Bitte die Firma angeben.";
  if (values.business_email?.trim() && !EMAIL.test(values.business_email.trim())) errors.business_email = "Keine gültige E-Mail-Adresse.";
  return errors;
}

async function run(values: Record<string, string>, success: string, call: () => PromiseLike<{ error: { code?: string; message?: string } | null }>): Promise<FormState> {
  const { error } = await call();
  if (error) return formError(databaseErrorMessage(error), values);
  refresh();
  return formSuccess(success, values);
}

export async function createCustomer(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const values = formValues(formData);
  if (values.customer_number?.trim() && !/^K?[-\s]?\d{4,}$/i.test(values.customer_number.trim())) {
    return formError("Bitte die markierten Felder prüfen.", values, { customer_number: "Format K-12345, oder leer lassen." });
  }
  const errors = { ...customerErrors(values), ...siteErrors(values) };
  if (Object.keys(errors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, errors);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_customer", {
    company_name: values.company_name.trim(), street_house_number: values.street_house_number.trim(), postal_code: values.postal_code.trim(), city: values.city.trim(),
    contact_name: text(values.contact_name), business_email: text(values.business_email), phone_number: text(values.phone_number), notes: text(values.notes),
    site_label: text(values.site_label), customer_number: text(values.customer_number),
  });
  if (error || !data) return formError(databaseErrorMessage(error), values);
  redirect(`/dashboard/kunden/${data.id}?angelegt=1`);
}

export async function updateCustomer(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const values = formValues(formData);
  const version = Number.parseInt(values.version ?? "", 10);
  if (!UUID.test(values.customer_id ?? "") || !Number.isInteger(version)) return invalid(values);
  const errors = customerErrors(values);
  if (Object.keys(errors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, errors);
  const supabase = await createClient();
  return run(values, "Gespeichert.", () => supabase.rpc("update_customer", {
    customer_id: values.customer_id, expected_version: version, company_name: values.company_name.trim(),
    contact_name: text(values.contact_name), business_email: text(values.business_email), phone_number: text(values.phone_number), notes: text(values.notes),
    is_active: values.is_active === "on",
  }));
}

export async function addSite(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const values = formValues(formData);
  if (!UUID.test(values.customer_id ?? "")) return invalid(values);
  const errors = siteErrors(values);
  if (Object.keys(errors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, errors);
  const supabase = await createClient();
  return run(values, "Standort hinzugefügt.", () => supabase.rpc("add_customer_site", {
    customer_id: values.customer_id, street_house_number: values.street_house_number.trim(), postal_code: values.postal_code.trim(), city: values.city.trim(), label: text(values.label),
  }));
}

export async function updateSite(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(STAFF);
  const values = formValues(formData);
  const version = Number.parseInt(values.version ?? "", 10);
  if (!UUID.test(values.site_id ?? "") || !Number.isInteger(version)) return invalid(values);
  const errors = siteErrors(values);
  if (Object.keys(errors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, errors);
  const supabase = await createClient();
  return run(values, "Standort gespeichert.", () => supabase.rpc("update_customer_site", {
    site_id: values.site_id, expected_version: version, street_house_number: values.street_house_number.trim(), postal_code: values.postal_code.trim(),
    city: values.city.trim(), label: text(values.label), is_active: values.is_active === "on",
  }));
}
