import "server-only";
import type { SendBacklog } from "@/lib/send-backlog";
import { createClient } from "@/lib/supabase/server";

// E-mails waiting longer than 10 minutes for the Gmail dispatch in n8n (task-12-9, RPC send_backlog). A read error
// shows no hint instead of breaking every dashboard page.
export const BACKLOG_MINUTES = 10;

export async function loadSendBacklog({ strict = false } = {}): Promise<SendBacklog> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_backlog", { min_minutes: BACKLOG_MINUTES });
  if (strict && (error || !data?.[0])) throw new Error("Versandstatus nicht verfügbar");
  const row = data?.[0];
  return { waiting: row?.waiting ?? 0, oldestAt: row?.oldest_at ?? null };
}
