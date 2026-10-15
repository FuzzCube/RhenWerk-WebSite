"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { absenceInterval, companyDetailsFrom, parseDecimal, parseWorkingHours, validateNewEmployee } from "@/lib/admin";
import { newPasswordErrors } from "@/lib/auth/password";
import { resetFailures } from "@/lib/auth/throttle-server";
import { EMPLOYEE_ROLES, isEmployeeRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { databaseErrorMessage, formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Administration actions (task-8-1), admin only. Changes go through the admin_* database operations with the
// admin's rights; only the login (Supabase Auth) needs the secret key: creating it, and blocking or releasing it
// on deactivation and reactivation. Passwords are passed to Supabase Auth and never stored in profiles.
type Enums = Database["public"]["Enums"];
const ADMIN = ["admin"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_KINDS: readonly string[] = ["inspection", "scheduled_maintenance", "diagnosis_repair"];
const BILLING_MODELS: readonly string[] = ["fixed", "hourly"];
// Ban for deactivated logins: blocks sign-in and token refresh until reactivation
const BLOCKED = "876000h";

type Result = PromiseLike<{ error: { code?: string; message?: string } | null }>;

async function run(values: Record<string, string>, success: string, call: () => Result): Promise<FormState> {
  const { error } = await call();
  if (error) return formError(databaseErrorMessage(error), values);
  refresh();
  return formSuccess(success, values);
}

const invalid = (values: Record<string, string>) => formError("Ungültige Anfrage. Bitte die Seite neu laden.", values);

export async function createEmployee(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ADMIN);
  const values = formValues(formData);
  const fieldErrors = validateNewEmployee(values, EMPLOYEE_ROLES);
  // The password is never sent back to the browser
  const { password, ...safeValues } = values;
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", safeValues, fieldErrors);

  const admin = createAdminClient();
  const email = values.email.trim().toLowerCase();
  const displayName = values.display_name.trim();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
  if (error || !data.user) {
    const exists = error?.code === "email_exists" || /already/i.test(error?.message ?? "");
    return exists
      ? formError("Für diese E-Mail-Adresse gibt es bereits ein Konto.", safeValues, { email: "Adresse bereits vergeben." })
      : formError("Das Konto konnte nicht angelegt werden. Bitte erneut versuchen.", safeValues);
  }

  const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, display_name: displayName, role: values.role as Enums["employee_role"] });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return formError("Das Profil konnte nicht angelegt werden. Es wurde kein Konto erstellt.", safeValues);
  }
  redirect(`/dashboard/verwaltung/mitarbeitende/${data.user.id}?angelegt=1`);
}

export async function updateEmployee(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ADMIN);
  const values = formValues(formData);
  if (!UUID.test(values.employee_id ?? "")) return invalid(values);
  const fieldErrors: Record<string, string> = {};
  if (!values.display_name?.trim()) fieldErrors.display_name = "Bitte den Namen angeben.";
  if (!isEmployeeRole(values.role)) fieldErrors.role = "Bitte eine Rolle wählen.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  return run(values, "Gespeichert.", () =>
    supabase.rpc("admin_update_employee", { employee_id: values.employee_id, display_name: values.display_name.trim(), role: values.role as Enums["employee_role"] }));
}

export async function deactivateEmployee(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ADMIN);
  const values = formValues(formData);
  if (!UUID.test(values.employee_id ?? "")) return invalid(values);
  if (values.replacement_id && !UUID.test(values.replacement_id)) return invalid(values);
  if (values.needs_replacement === "1" && !values.replacement_id) {
    return formError("Bitte eine Vertretung für die Neuzuweisung wählen.", values, { replacement_id: "Pflichtangabe bei aktiven Zuweisungen." });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_deactivate_employee", { employee_id: values.employee_id, replacement_id: values.replacement_id || undefined });
  if (error) return formError(databaseErrorMessage(error), values);

  // The deactivation section disappears after the change, so the result is shown via the URL
  const moved = data as { reassigned_requests?: number; reassigned_visits?: number; reassigned_inbox?: number } | null;
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(values.employee_id, { ban_duration: BLOCKED });
  const query = new URLSearchParams({ ergebnis: "deaktiviert", anfragen: String(moved?.reassigned_requests ?? 0), einsaetze: String(moved?.reassigned_visits ?? 0), posteingang: String(moved?.reassigned_inbox ?? 0) });
  if (banError) query.set("sperre", "fehlgeschlagen");
  redirect(`/dashboard/verwaltung/mitarbeitende/${values.employee_id}?${query}`);
}

// Temporary password for an employee who cannot use the reset link (task-11-5). Not for the own account (that
// goes through "Mein Konto" with the current password). The password only goes to Supabase Auth.
export async function setEmployeePassword(_previous: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole(ADMIN);
  const { employee_id = "", password = "", password_repeat = "" } = formValues(formData);
  if (!UUID.test(employee_id)) return invalid({});
  if (employee_id === admin.id) return formError("Das eigene Passwort bitte unter „Mein Konto“ ändern.", {});
  const fieldErrors = newPasswordErrors(password, password_repeat);
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", {}, fieldErrors);
  const { data: updated, error } = await createAdminClient().auth.admin.updateUserById(employee_id, { password });
  if (error) return formError("Das Passwort konnte nicht gesetzt werden. Bitte erneut versuchen.", {});
  // The person can sign in at once, even during a pause from wrong attempts (task-11-6)
  await resetFailures(updated.user.email ?? "");
  return formSuccess("Neues Passwort gesetzt. Bitte der Person persönlich mitteilen.");
}

export async function reactivateEmployee(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ADMIN);
  const values = formValues(formData);
  if (!UUID.test(values.employee_id ?? "")) return invalid(values);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reactivate_employee", { employee_id: values.employee_id });
  if (error) return formError(databaseErrorMessage(error), values);
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(values.employee_id, { ban_duration: "none" });
  redirect(`/dashboard/verwaltung/mitarbeitende/${values.employee_id}?ergebnis=aktiviert${banError ? "&sperre=fehlgeschlagen" : ""}`);
}

export async function saveWorkingHours(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ADMIN);
  const values = formValues(formData);
  if (!UUID.test(values.employee_id ?? "")) return invalid(values);
  const { hours, fieldErrors } = parseWorkingHours(values);
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Zeiten prüfen.", values, fieldErrors);
  const supabase = await createClient();
  return run(values, "Arbeitszeiten gespeichert.", () => supabase.rpc("admin_set_working_hours", { employee_id: values.employee_id, hours: hours as unknown as Json }));
}

export async function addAbsence(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ADMIN);
  const values = formValues(formData);
  if (!UUID.test(values.employee_id ?? "")) return invalid(values);
  const interval = absenceInterval(values.from, values.to);
  if (!interval) return formError("Bitte einen gültigen Zeitraum angeben.", values, { to: "Bis-Datum darf nicht vor dem Von-Datum liegen." });
  const supabase = await createClient();
  return run(values, "Abwesenheit eingetragen.", () =>
    supabase.rpc("admin_add_absence", { employee_id: values.employee_id, ...interval, label: values.label?.trim() || undefined }));
}

export async function deleteAbsence(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ADMIN);
  const values = formValues(formData);
  if (!UUID.test(values.absence_id ?? "")) return invalid(values);
  const supabase = await createClient();
  return run(values, "Abwesenheit entfernt.", () => supabase.rpc("admin_delete_absence", { absence_id: values.absence_id }));
}

export async function saveRate(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ADMIN);
  const values = formValues(formData);
  if (values.rate_id && !UUID.test(values.rate_id)) return invalid(values);
  const price = parseDecimal(values.unit_price);
  const tax = parseDecimal(values.tax_rate);
  const fieldErrors: Record<string, string> = {};
  if (!values.code?.trim()) fieldErrors.code = "Bitte ein Kürzel angeben.";
  if (!values.display_name?.trim()) fieldErrors.display_name = "Bitte eine Bezeichnung angeben.";
  if (!SERVICE_KINDS.includes(values.service_kind ?? "")) fieldErrors.service_kind = "Bitte die Leistungsart wählen.";
  if (!BILLING_MODELS.includes(values.billing_model ?? "")) fieldErrors.billing_model = "Bitte das Abrechnungsmodell wählen.";
  if (price === null || price < 0) fieldErrors.unit_price = "Preis als Zahl ab 0 angeben.";
  if (tax === null || tax < 0 || tax > 100) fieldErrors.tax_rate = "Steuersatz zwischen 0 und 100 angeben.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  return run(values, values.rate_id ? "Tarif gespeichert." : "Tarif angelegt.", () =>
    supabase.rpc("admin_save_service_rate", {
      rate_id: (values.rate_id || null) as string,
      code: values.code.trim(),
      service_kind: values.service_kind as Enums["service_kind"],
      display_name: values.display_name.trim(),
      billing_model: values.billing_model as Enums["billing_model"],
      unit_price: price as number,
      tax_rate: tax as number,
      is_active: values.is_active === "on",
    }));
}

export async function saveSettings(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ADMIN);
  const values = formValues(formData);
  const minutes = parseDecimal(values.manual_intake_minutes);
  const tax = parseDecimal(values.default_tax_rate);
  const terms = parseDecimal(values.payment_terms_days);
  const fieldErrors: Record<string, string> = {};
  if (minutes === null || minutes <= 0) fieldErrors.manual_intake_minutes = "Minuten größer als 0 angeben.";
  if (tax === null || tax < 0 || tax > 100) fieldErrors.default_tax_rate = "Steuersatz zwischen 0 und 100 angeben.";
  if (terms === null || !Number.isInteger(terms) || terms < 0 || terms > 365) fieldErrors.payment_terms_days = "Ganze Tage zwischen 0 und 365 angeben.";
  if (!values.company_company_name?.trim()) fieldErrors.company_company_name = "Bitte den Firmennamen angeben.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);

  const supabase = await createClient();
  const { data: current, error } = await supabase.from("settings").select("company_details").eq("id", 1).single();
  if (error) return formError("Einstellungen konnten nicht geladen werden. Bitte erneut versuchen.", values);
  const stored = current.company_details && typeof current.company_details === "object" && !Array.isArray(current.company_details) ? (current.company_details as Record<string, unknown>) : {};
  return run(values, "Einstellungen gespeichert. Sie gelten für spätere Erstbearbeitungen und Rechnungen.", () =>
    supabase.rpc("admin_update_settings", {
      manual_intake_minutes: minutes as number,
      default_tax_rate: tax as number,
      payment_terms_days: terms as number,
      company_details: companyDetailsFrom(values, stored) as Json,
    }));
}

// Payment reminder stages (task-10-2): days per stage, empty = stage off. Only reminders not yet created change.
const REMINDER_FIELDS = ["reminder_stage1_days", "reminder_stage2_days", "reminder_stage3_days"] as const;

export async function saveReminderSettings(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(ADMIN);
  const values = formValues(formData);
  const fieldErrors: Record<string, string> = {};
  const days = REMINDER_FIELDS.map((key) => {
    const raw = values[key]?.trim() ?? "";
    if (!raw) return null;
    const value = parseDecimal(raw);
    if (value === null || !Number.isInteger(value) || value < 1 || value > 90) fieldErrors[key] = "Ganze Tage zwischen 1 und 90 oder leer für „aus“.";
    return value;
  });
  if (days[1] !== null && days[0] === null) fieldErrors.reminder_stage2_days = "Setzt die Zahlungserinnerung voraus.";
  if (days[2] !== null && days[1] === null) fieldErrors.reminder_stage3_days = "Setzt die 1. Mahnung voraus.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);
  const supabase = await createClient();
  // The generated types mark the arguments as required numbers; null switches a stage off
  const args = { stage1_days: days[0], stage2_days: days[1], stage3_days: days[2] } as unknown as { stage1_days: number; stage2_days: number; stage3_days: number };
  return run(values, "Erinnerungsstufen gespeichert. Sie gelten für Erinnerungen, die noch nicht erstellt wurden.", () =>
    supabase.rpc("admin_update_reminder_settings", args));
}
