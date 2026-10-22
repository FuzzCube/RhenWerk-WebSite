"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { databaseErrorMessage } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

// "Erledigt" (task-17-10): only admin closes a warning by hand (resolve_alert checks it again); if the cause persists,
// the next check of the watchdog opens a new one.
type Result = { ok: true } | { ok: false; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function resolveAlert(alertId: string): Promise<Result> {
  await requireRole(["admin"]);
  if (!UUID.test(alertId)) return { ok: false, message: "Ungültige Eingabe. Bitte die Seite neu laden." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_alert", { alert_id: alertId });
  if (error) return { ok: false, message: databaseErrorMessage(error) };
  refresh();
  return { ok: true };
}

// "Jetzt sichern" (task-18-6): only admin files a request (request_backup checks it again, manager 42501); the
// service rheinwerk-systemcheck on the VPS runs the backup with restore check
export async function requestBackup(): Promise<Result> {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_backup");
  if (error) return { ok: false, message: databaseErrorMessage(error) };
  refresh();
  return { ok: true };
}

// "System prüfen" (task-17-15): only admin files a request (request_system_check checks it again); the service
// online.rheinwerk.systemcheck on the host runs the checks
export async function requestSystemCheck(): Promise<Result> {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_system_check");
  if (error) return { ok: false, message: databaseErrorMessage(error) };
  refresh();
  return { ok: true };
}
