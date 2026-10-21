// Results of the watchdog in the area "System" (task-17-9): state per system and the credit of external services.
// The watchdog (scripts/prod/watchdog.mjs) writes system_status.monitoring every 5 minutes; an entry older than
// 15 minutes means the watchdog itself does not run. Pure functions, shared by page and unit tests.
import type { DisplayStatus } from "./display-status";

export type MonitorCheck = { key: string; label: string; ok: boolean | null; severity: "warning" | "critical"; title: string | null; detail: string };
export type Credit = { used: number; limit: number; remaining: number; min: number; tier: string; reset_at: string | null };
export type MonitorEntry = { state: "off" | "ok" | "warning" | "critical"; checked_at: string; checks?: MonitorCheck[]; credit?: Credit | null };
export type Monitoring = Partial<Record<"mira", MonitorEntry>>;

export const STALE_AFTER_MINUTES = 15;

const STATE: Record<MonitorEntry["state"] | "stale", DisplayStatus> = {
  ok: { key: "in-ordnung", label: "In Ordnung", tone: "done" },
  warning: { key: "warnung", label: "Warnung", tone: "wait" },
  critical: { key: "gestoert", label: "Gestört", tone: "act" },
  off: { key: "nicht-eingerichtet", label: "Nicht eingerichtet", tone: "closed" },
  stale: { key: "veraltet", label: "Prüfung veraltet", tone: "wait" },
};

export function isStale(entry: Pick<MonitorEntry, "checked_at">, now: Date): boolean {
  return now.getTime() - Date.parse(entry.checked_at) > STALE_AFTER_MINUTES * 60_000;
}

export function monitorStatus(entry: MonitorEntry, now: Date): DisplayStatus {
  return isStale(entry, now) ? STATE.stale : STATE[entry.state];
}

// Failed checks first (title), then skipped ones with their reason; passing checks are not listed
export function monitorNotes(entry: MonitorEntry): { text: string; tone: "bad" | "muted" }[] {
  const checks = entry.checks ?? [];
  return [
    ...checks.filter((c) => c.ok === false).map((c) => ({ text: c.title ?? c.label, tone: "bad" as const })),
    ...checks.filter((c) => c.ok === null).map((c) => ({ text: c.detail, tone: "muted" as const })),
  ];
}

export type CreditView = { share: number; low: boolean; empty: boolean };

export function creditView(credit: Credit): CreditView {
  return {
    share: credit.limit > 0 ? Math.min(1, Math.max(0, credit.remaining / credit.limit)) : 0,
    low: credit.remaining < credit.min,
    empty: credit.remaining <= 0,
  };
}
