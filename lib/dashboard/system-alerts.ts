import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SystemAlert } from "@/lib/system-summary";

// Open warnings for the banner on every dashboard page (task-17-10). RLS: only manager and admin read
// system_alerts; a read error shows no banner instead of breaking every page.
export async function loadOpenSystemAlerts({ strict = false } = {}): Promise<SystemAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("system_alerts").select("id, source, severity, title, first_seen_at").is("resolved_at", null);
  if (strict && error) throw new Error("Systemwarnungen nicht verfügbar");
  return (data ?? []) as SystemAlert[];
}
