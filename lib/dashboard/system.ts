import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SystemAlert } from "@/lib/system-summary";

// Area "System" (task-17-12): open warnings and the versions of npm packages and n8n reported by the nightly run, read
// with the user's rights (RLS: only manager and admin). The scripts on the host write these tables (scripts/prod).
export type DependencyUpdates = {
  checked_at?: string;
  npm?: { name: string; current: string; wanted: string; latest: string }[] | null;
  n8n?: { current: string; latest: string; update: boolean } | null;
};

export type SystemOverview = {
  alerts: SystemAlert[];
  dependencies: DependencyUpdates;
  error: boolean;
};

export async function loadSystemOverview(): Promise<SystemOverview> {
  const supabase = await createClient();
  const [status, alerts] = await Promise.all([
    supabase.from("system_status").select("dependency_updates").maybeSingle(),
    supabase.from("system_alerts").select("id, source, severity, title, first_seen_at").is("resolved_at", null),
  ]);
  return {
    alerts: (alerts.data ?? []) as SystemAlert[],
    dependencies: (status.data?.dependency_updates as DependencyUpdates | undefined) ?? {},
    error: Boolean(status.error || alerts.error),
  };
}
