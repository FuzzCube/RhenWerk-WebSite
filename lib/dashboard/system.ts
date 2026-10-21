import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Monitoring } from "@/lib/system-monitoring";
import type { SystemAlertRow } from "@/lib/system-summary";

// Area "System" (task-17-12): open warnings, the versions of npm packages and n8n reported by the nightly run and the
// results of the watchdog (task-17-9), read with the user's rights (RLS: only manager and admin). The services on the host write these tables (scripts/ops).
export type DependencyUpdates = {
  checked_at?: string;
  npm?: { name: string; current: string; wanted: string; latest: string }[] | null;
  n8n?: { current: string; latest: string; update: boolean } | null;
};

export type SystemOverview = {
  alerts: SystemAlertRow[];
  resolvedAlerts: SystemAlertRow[];
  dependencies: DependencyUpdates;
  monitoring: Monitoring;
  error: boolean;
};

// Warnings (task-17-10): open ones and the ones resolved in the last 30 days (older are deleted after 90 days)
const RESOLVED_DAYS = 30;
const ALERT_COLUMNS = "id, source, severity, title, detail, first_seen_at, last_seen_at, occurrences, resolved_at, resolved_reason, resolver:profiles!system_alerts_resolved_by_fkey(display_name)";
function alertRow({ resolver, ...row }: Record<string, unknown>): SystemAlertRow {
  return { ...(row as Omit<SystemAlertRow, "resolver">), resolver: (resolver as { display_name: string } | null)?.display_name ?? null };
}

export async function loadSystemOverview(): Promise<SystemOverview> {
  const supabase = await createClient();
  const since = new Date(Date.now() - RESOLVED_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [status, alerts, resolved] = await Promise.all([
    supabase.from("system_status").select("dependency_updates, monitoring").maybeSingle(),
    supabase.from("system_alerts").select(ALERT_COLUMNS).is("resolved_at", null),
    supabase.from("system_alerts").select(ALERT_COLUMNS).gte("resolved_at", since).order("resolved_at", { ascending: false }).limit(30),
  ]);
  return {
    alerts: (alerts.data ?? []).map(alertRow),
    resolvedAlerts: (resolved.data ?? []).map(alertRow),
    dependencies: (status.data?.dependency_updates as DependencyUpdates | undefined) ?? {},
    monitoring: (status.data?.monitoring as Monitoring | undefined) ?? {},
    error: Boolean(status.error || alerts.error || resolved.error),
  };
}
