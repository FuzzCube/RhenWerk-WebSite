import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BackupRow, ProviderBackup } from "@/lib/backups";
import type { CheckRequest, Monitoring, VersionRow } from "@/lib/system-monitoring";
import type { SystemAlertRow } from "@/lib/system-summary";

// Area "System" (task-17-12): open warnings, the versions reported by the nightly run (task-17-15), the results of the
// watchdog (task-17-9) and a pending "System prüfen", read with the user's rights (RLS: only manager and admin). The
// services on the host write these tables (scripts/ops).
export type DependencyUpdates = {
  checked_at?: string;
  versions?: VersionRow[];
};

export type SystemOverview = {
  alerts: SystemAlertRow[];
  resolvedAlerts: SystemAlertRow[];
  dependencies: DependencyUpdates;
  monitoring: Monitoring;
  checkRequest: CheckRequest;
  backups: BackupRow[];
  backupRequest: CheckRequest;
  provider: ProviderBackup | null;
  error: boolean;
};

// Warnings (task-17-10): open ones and the ones resolved in the last 30 days (older are deleted after 90 days)
const RESOLVED_DAYS = 30;
const ALERT_COLUMNS = "id, source, severity, title, detail, first_seen_at, last_seen_at, occurrences, resolved_at, resolved_reason, resolver:profiles!system_alerts_resolved_by_fkey(display_name)";
function alertRow({ resolver, ...row }: Record<string, unknown>): SystemAlertRow {
  return { ...(row as Omit<SystemAlertRow, "resolver">), resolver: (resolver as { display_name: string } | null)?.display_name ?? null };
}

// Backups of the last 14 days (task-18-6; the archives on the VPS are kept 14 days, the rows 90 days)
const BACKUP_DAYS = 14;
const BACKUP_COLUMNS = "id, started_at, finished_at, reason, status, file_name, size_bytes, contents, verified, error, requester:profiles!backups_requested_by_fkey(display_name)";

export async function loadSystemOverview(): Promise<SystemOverview> {
  const supabase = await createClient();
  const since = new Date(Date.now() - RESOLVED_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const backupSince = new Date(Date.now() - BACKUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [status, alerts, resolved, backups] = await Promise.all([
    supabase.from("system_status").select("dependency_updates, monitoring, check_requested_at, check_started_at, backup_requested_at, backup_started_at").maybeSingle(),
    supabase.from("system_alerts").select(ALERT_COLUMNS).is("resolved_at", null),
    supabase.from("system_alerts").select(ALERT_COLUMNS).gte("resolved_at", since).order("resolved_at", { ascending: false }).limit(30),
    supabase.from("backups").select(BACKUP_COLUMNS).gte("finished_at", backupSince).order("finished_at", { ascending: false }).limit(60),
  ]);
  const monitoring = (status.data?.monitoring as (Monitoring & { backup?: { provider?: ProviderBackup | null } }) | undefined) ?? {};
  return {
    alerts: (alerts.data ?? []).map(alertRow),
    resolvedAlerts: (resolved.data ?? []).map(alertRow),
    dependencies: (status.data?.dependency_updates as DependencyUpdates | undefined) ?? {},
    monitoring,
    checkRequest: { requested_at: status.data?.check_requested_at ?? null, started_at: status.data?.check_started_at ?? null },
    backups: (backups.data ?? []).map(({ requester, ...row }) => ({
      ...(row as Omit<BackupRow, "requester">), requester: (requester as { display_name: string } | null)?.display_name ?? null,
    })),
    backupRequest: { requested_at: status.data?.backup_requested_at ?? null, started_at: status.data?.backup_started_at ?? null },
    provider: monitoring.backup?.provider ?? null,
    error: Boolean(status.error || alerts.error || resolved.error || backups.error),
  };
}
