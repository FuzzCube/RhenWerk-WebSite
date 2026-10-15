"use server";

import { requireRole } from "@/lib/auth/session";
import { databaseErrorMessage } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Kunde angerufen" (task-13-4): one controlled operation with the user's rights; who may confirm is checked there
export async function acknowledgeCallback(callbackId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["technician", "dispatcher", "manager", "admin"]);
  if (!UUID.test(callbackId)) return { ok: false, message: "Ungültige Eingabe. Bitte die Seite neu laden." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_callback", { callback_id: callbackId });
  return error ? { ok: false, message: databaseErrorMessage(error) } : { ok: true };
}
