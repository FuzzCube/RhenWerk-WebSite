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
