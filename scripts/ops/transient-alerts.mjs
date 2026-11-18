// Only known connection failures are delayed; unknown errors and access failures stay immediate.
export const HOLD_MS = 20 * 60_000;
const networkError = /(?:DNS server returned an error|DNS lookup|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|connection (?:was )?(?:aborted|reset|timed out)|timeout|timed out)/i;

export function isTransientAlert(alert) {
  if (alert.alert_key === "mira:agent") return /Telefonassistent: ElevenLabs nicht erreichbar/.test(alert.title ?? "") && networkError.test(alert.detail ?? "");
  if (alert.alert_key?.startsWith("n8n:fehler:")) return networkError.test((alert.detail ?? "").match(/(?:^|\n)Fehler: ([^\n]*)/)?.[1] ?? "");
  return false;
}

export function holdPending(alert, now = Date.now()) {
  if (alert.notified_at || !isTransientAlert(alert)) return false;
  const first = Date.parse(alert.first_seen_at);
  return Number.isFinite(first) && now >= first && now - first < HOLD_MS;
}

// Two successful observations separated by four minutes prevent manual rechecks from clearing a flap.
export function agentRecovery(check, previous, now = Date.now()) {
  if (check.ok !== true) return { check, observation: null };
  if (!previous?.pending) return { check, observation: null };
  const first = Date.parse(previous.first_success_at);
  if (Number.isFinite(first) && now - first >= 4 * 60_000) return { check, observation: null };
  return { check: { ...check, ok: null }, observation: { pending: true, first_success_at: Number.isFinite(first) ? previous.first_success_at : new Date(now).toISOString() } };
}
