// Backups in the area "System" (task-18-6): rows of public.backups (daily at 03:00, "Jetzt sichern", before a migration
// of the deployment, before a restore) and the state of the provider's backup (OVHcloud) from the watchdog; restores
// (task-18-7, public.restores). Pure functions, shared by page and unit tests (tests/unit/backups-view.test.mjs).
import type { DisplayStatus } from "./display-status";

export type BackupReason = "daily" | "manual" | "migration" | "pre_restore" | "pre_update";
export type BackupRow = {
  id: string;
  started_at: string;
  finished_at: string;
  reason: BackupReason;
  status: "ok" | "failed";
  file_name: string | null;
  size_bytes: number | null;
  contents: Record<string, unknown>;
  verified: boolean | null;
  error: string | null;
  requester: string | null;
};
export type ProviderBackup = { state?: string | null; schedule?: string | null; rotation?: number | null; restore_points?: number | null; last_restore_point?: string | null; error?: string };

const REASON: Record<BackupReason, string> = { daily: "Täglich", manual: "Von Hand", migration: "Vor Migration", pre_restore: "Vor Wiederherstellung", pre_update: "Vor Systemupdate" };
export const backupReasonLabel = (reason: BackupReason): string => REASON[reason] ?? reason;

export function backupStatus(row: Pick<BackupRow, "status" | "verified">): DisplayStatus {
  if (row.status === "failed") return { key: "fehlgeschlagen", label: "Fehlgeschlagen", tone: "act" };
  if (row.verified) return { key: "geprueft", label: "Geprüft", tone: "done" };
  return { key: "ohne-pruefung", label: "Ohne Probewiederherstellung", tone: "closed" };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "–";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1024 / 1024;
  return `${mb.toLocaleString("de-DE", { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

// Contents of a backup in the order an owner asks for them; keys missing in older rows are left out
const CONTENTS: [string, string][] = [
  ["public.requests", "Anfragen"], ["public.customers", "Kunden"], ["public.invoices", "Rechnungen"], ["public.visits", "Termine"],
  ["public.messages", "Nachrichten"], ["public.phone_calls", "Anrufe"], ["auth.users", "Konten"], ["storage_files", "Dateien"],
  ["n8n_workflows", "Workflows (n8n)"], ["migrations", "Migrationen"], ["commit", "Commit"],
];
export function backupContents(contents: Record<string, unknown>): { label: string; value: string }[] {
  return CONTENTS.filter(([key]) => contents[key] !== undefined && contents[key] !== null)
    .map(([key, label]) => ({ label, value: typeof contents[key] === "number" ? (contents[key] as number).toLocaleString("de-DE") : String(contents[key]) }));
}

// Newest backup with passed restore check (the one to restore from), null if none
export function latestVerified(rows: BackupRow[]): BackupRow | null {
  return rows.find((row) => row.status === "ok" && row.verified === true) ?? null;
}

export function providerView(provider: ProviderBackup | null | undefined): { status: DisplayStatus; text: string } {
  if (!provider) return { status: { key: "nicht-eingerichtet", label: "Nicht abgefragt", tone: "closed" }, text: "Täglich beim Anbieter (OVHcloud), ganzer Server; Zustand wird ohne API-Schlüssel nicht abgefragt." };
  if (provider.error) return { status: { key: "warnung", label: "Nicht abrufbar", tone: "wait" }, text: `OVHcloud-API: ${provider.error}` };
  if (provider.state !== "enabled") return { status: { key: "warnung", label: "Ausgeschaltet", tone: "wait" }, text: `Automatische Sicherung bei OVHcloud: ${provider.state ?? "unbekannt"}.` };
  // Restore points only when the key may read them; otherwise the number the provider keeps (rotation)
  const count = provider.restore_points ?? provider.rotation ?? null;
  return {
    status: { key: "in-ordnung", label: "Aktiv", tone: "done" },
    text: `Täglich${provider.schedule ? ` um ${provider.schedule.slice(0, 5)}` : ""} beim Anbieter (OVHcloud), ganzer Server${count === null ? "" : `; ${count === 1 ? "1 Sicherungspunkt" : `${count} Sicherungspunkte`}`}.`,
  };
}

// Restore (task-18-7): only admin, only a complete checked backup of the last 14 days (archives are kept 14 days on the
// server) with the migration state of the database (request_restore checks the same)
export const RESTORE_WORD = "WIEDERHERSTELLEN";
export const RESTORE_DAYS = 14;
export const confirmationMatches = (input: string): boolean => input.trim().toUpperCase() === RESTORE_WORD;

export function restorable(row: BackupRow, migration: string | null, now: Date): boolean {
  return row.status === "ok" && row.verified === true && row.reason !== "migration" && Boolean(row.file_name)
    && migration !== null && row.contents.migration === migration
    && now.getTime() - Date.parse(row.finished_at) <= RESTORE_DAYS * 24 * 60 * 60 * 1000;
}

export type RestoreRow = {
  id: string;
  file_name: string;
  backup_finished_at: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  status: "requested" | "running" | "ok" | "failed" | "rolled_back";
  pre_backup_file: string | null;
  error: string | null;
  requester: string | null;
};

// Requested or running; the database gives up a request after an hour
export function restoreActive(row: RestoreRow | null | undefined, now: Date): boolean {
  return Boolean(row && (row.status === "requested" || row.status === "running") && now.getTime() - Date.parse(row.requested_at) < 60 * 60 * 1000);
}

export function restoreStatus(row: RestoreRow, now: Date): DisplayStatus {
  if (row.status === "requested" || row.status === "running") {
    if (!restoreActive(row, now)) return { key: "abgebrochen", label: "Nicht abgeschlossen", tone: "act" };
    return row.status === "running" ? { key: "laeuft", label: "Läuft", tone: "run" } : { key: "angefordert", label: "Angefordert", tone: "wait" };
  }
  if (row.status === "ok") return { key: "wiederhergestellt", label: "Wiederhergestellt", tone: "done" };
  if (row.status === "rolled_back") return { key: "zurueck", label: "Fehlgeschlagen, Stand davor zurück", tone: "act" };
  return { key: "fehlgeschlagen", label: "Fehlgeschlagen", tone: "act" };
}

// System updates of the images on the VPS (task-18-8, public.image_updates)
export type ImageUpdateRow = {
  id: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  status: "requested" | "running" | "ok" | "no_change" | "failed" | "rolled_back";
  changes: { service: string; from: string | null; to: string | null }[];
  pre_backup_file: string | null;
  error: string | null;
  requester: string | null;
};

export function imageUpdateActive(row: ImageUpdateRow | null | undefined, now: Date): boolean {
  return Boolean(row && (row.status === "requested" || row.status === "running") && now.getTime() - Date.parse(row.requested_at) < 60 * 60 * 1000);
}

export function imageUpdateStatus(row: ImageUpdateRow, now: Date): DisplayStatus {
  if (row.status === "requested" || row.status === "running") {
    if (!imageUpdateActive(row, now)) return { key: "abgebrochen", label: "Nicht abgeschlossen", tone: "act" };
    return row.status === "running" ? { key: "laeuft", label: "Läuft", tone: "run" } : { key: "angefordert", label: "Angefordert", tone: "wait" };
  }
  if (row.status === "ok") return { key: "eingespielt", label: "Eingespielt", tone: "done" };
  if (row.status === "no_change") return { key: "unveraendert", label: "Nichts zu tun", tone: "closed" };
  if (row.status === "rolled_back") return { key: "zurueck", label: "Fehlgeschlagen, Stand von vorher läuft", tone: "act" };
  return { key: "fehlgeschlagen", label: "Fehlgeschlagen", tone: "act" };
}

export const imageChanges = (row: Pick<ImageUpdateRow, "changes">): string =>
  row.changes.length ? row.changes.map((change) => `${change.service} ${change.from ?? "?"} → ${change.to ?? "?"}`).join(", ") : "–";
