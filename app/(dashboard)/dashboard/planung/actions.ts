"use server";

import { refresh } from "next/cache";
import { berlinToInstant, isDayKey, isTime } from "@/lib/berlin-time";
import { requireRole } from "@/lib/auth/session";
import { formatTimeRange } from "@/lib/format";
import { databaseErrorMessage, formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Books a visit via schedule_visit (task-2-2). The database checks role, assignment, state,
// working hours, absences, the past and overlaps (exclusion constraint, RW410) – also for concurrent bookings.
export async function scheduleVisit(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["dispatcher", "manager"]);
  const values = formValues(formData);
  const version = Number.parseInt(values.version ?? "", 10);
  if (!UUID.test(values.request_id ?? "") || !Number.isInteger(version)) return formError("Ungültige Anfrage. Bitte die Seite neu laden.", values);

  const fieldErrors: Record<string, string> = {};
  if (!UUID.test(values.technician_id ?? "")) fieldErrors.technician_id = "Bitte einen Techniker wählen.";
  if (!isDayKey(values.date)) fieldErrors.date = "Bitte ein Datum wählen.";
  if (!isTime(values.start)) fieldErrors.start = "Bitte eine Beginnzeit wählen.";
  if (!isTime(values.end)) fieldErrors.end = "Bitte eine Endzeit wählen.";
  if (!fieldErrors.start && !fieldErrors.end && values.end <= values.start) fieldErrors.end = "Ende muss nach dem Beginn liegen.";
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", values, fieldErrors);

  const start = berlinToInstant(values.date, values.start);
  const end = berlinToInstant(values.date, values.end);
  const supabase = await createClient();
  const { error } = await supabase.rpc("schedule_visit", {
    request_id: values.request_id,
    expected_version: version,
    technician_id: values.technician_id,
    scheduled_start: start.toISOString(),
    scheduled_end: end.toISOString(),
  });
  if (error) {
    const hint = error.code === "RW410" ? " Bitte im Kalender einen freien Zeitraum wählen." : "";
    return formError(`${databaseErrorMessage(error)}${hint}`, values, error.code === "RW410" ? { start: "Zeitraum belegt." } : {});
  }
  refresh();
  return formSuccess(`Einsatz geplant: ${formatTimeRange(start, end)}.`, values);
}

// Same text the board prefills
const DEFAULT_RESCHEDULE_REASON = "Verschoben auf der Plantafel";

// Moves a planned visit dragged on the board (task-10-8) via reschedule_visit: the database checks role, access,
// the request version, state (only scheduled visits of open requests), the past, working hours, absences and
// overlaps (RW410). The reason is prefilled on the board and may be changed; empty falls back to the default.
export async function rescheduleVisit(_previous: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["dispatcher", "manager"]);
  const values = formValues(formData);
  const version = Number.parseInt(values.version ?? "", 10);
  if (!UUID.test(values.visit_id ?? "") || !Number.isInteger(version)) return formError("Ungültiger Einsatz. Bitte die Seite neu laden.", values);
  if (!UUID.test(values.technician_id ?? "") || !isDayKey(values.date) || !isTime(values.start) || !isTime(values.end) || values.end <= values.start) {
    return formError("Ungültiger Zeitraum. Bitte erneut ziehen.", values);
  }
  const reason = (values.reason ?? "").trim() || DEFAULT_RESCHEDULE_REASON;
  if (reason.length > 500) return formError("Grund ist zu lang (höchstens 500 Zeichen).", values, { reason: "Zu lang." });

  const start = berlinToInstant(values.date, values.start);
  const end = berlinToInstant(values.date, values.end);
  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_visit", {
    visit_id: values.visit_id,
    expected_version: version,
    scheduled_start: start.toISOString(),
    scheduled_end: end.toISOString(),
    reason,
    technician_id: values.technician_id,
  });
  if (error) {
    // Version conflict: someone changed the request meanwhile; reload the board so the user sees the current plan
    if (error.code === "RW409") {
      refresh();
      return formError("Die Anfrage wurde inzwischen geändert. Die Plantafel ist neu geladen – bitte prüfen und erneut auf „Verschieben“ klicken.", values);
    }
    return formError(`${databaseErrorMessage(error)}${error.code === "RW410" ? " Bitte einen freien Zeitraum wählen." : ""}`, values);
  }
  refresh();
  return formSuccess(`Einsatz verschoben: ${formatTimeRange(start, end)}.`, values);
}
