import assert from "node:assert/strict";
import { test } from "node:test";
import { agentRecovery, holdPending, isTransientAlert } from "../../scripts/ops/transient-alerts.mjs";
import { notificationCandidates, notifyDue, report } from "../../scripts/ops/lib.mjs";
import { evaluateN8n } from "../../scripts/ops/n8n.mjs";

const now = Date.parse("2026-11-18T16:00:00Z");
const time = (minutes) => new Date(now + minutes * 60_000).toISOString();
const agent = { alert_key: "mira:agent", title: "Telefonassistent: ElevenLabs nicht erreichbar", detail: "Abfrage des Agenten: TimeoutError.", first_seen_at: time(0), notified_at: null };
const workflow = { alert_key: "n8n:fehler:IlH4b7AKuSXyMiOd", title: "Gmail fehlgeschlagen", detail: "Schritt: Versandpostfach prüfen\nFehler: The DNS server returned an error, perhaps the server is offline", first_seen_at: time(0), last_seen_at: time(0), notified_at: null, severity: "critical" };

test("Bekannte Netzfehler warten 20 Minuten; Zugang und Warteschlangen bleiben sofort fällig", () => {
  for (const a of [agent, workflow]) {
    assert.equal(isTransientAlert(a), true);
    assert.equal(holdPending(a, now + 19 * 60_000), true);
    assert.equal(holdPending(a, now + 20 * 60_000), false);
    assert.equal(holdPending({ ...a, notified_at: time(1) }, now), false);
  }
  const credential = { ...workflow, detail: 'Fehler: The credential "RheinWerk Gmail" needs to be reconnected.' };
  const queue = { ...workflow, alert_key: "n8n:versandstau" };
  assert.deepEqual(notificationCandidates([agent, workflow, credential, queue], false, now), [credential, queue]);
  assert.equal(holdPending({ ...workflow, first_seen_at: "invalid" }, now), false);
});

test("Erste Mira-Warnung wird gespeichert aber nicht sofort gesendet; Zugangsfehler sofort", async () => {
  const mails = [];
  const call = async () => ({ alert_id: "id", notify: true, reason: "new" });
  const send = async (mail) => { mails.push(mail); return { ok: true }; };
  await report("mira", { key: agent.alert_key, title: agent.title, detail: agent.detail, severity: "warning", ok: false }, { call, send });
  assert.equal(mails.length, 0);
  await report("mira", { key: agent.alert_key, title: "Telefonassistent: Zugang zu ElevenLabs abgelehnt", detail: "HTTP 401", severity: "critical", ok: false }, { call, send });
  assert.equal(mails.length, 1);
});

test("Mira braucht zwei zeitlich getrennte Erfolge; neuer Fehler setzt zurück", () => {
  const ok = { ok: true };
  const first = agentRecovery(ok, { pending: true }, now);
  assert.equal(first.check.ok, null);
  assert.equal(agentRecovery(ok, first.observation, now + 60_000).check.ok, null);
  assert.equal(agentRecovery(ok, first.observation, now + 4 * 60_000).check.ok, true);
  assert.equal(agentRecovery({ ok: false }, first.observation, now).observation, null);
});

test("Vorzeitige Erholung erzeugt kein E-Mail-Paar; längerer Ausfall eine Warnung und Entwarnung", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  for (const duration of [10, 25]) {
    t.mock.timers.setTime(now);
    let row = null;
    const mails = [];
    const call = async (name) => {
      if (name === "raise_alert") { row ??= { ...agent, id: "id", first_seen_at: new Date().toISOString() }; return { alert_id: row.id, notify: !row.notified_at, reason: "new" }; }
      if (name === "alerts_to_notify") return row && !row.notified_at ? [row] : [];
      if (name === "mark_alert_notified") { row.notified_at = new Date().toISOString(); return; }
      if (name === "clear_alert") { const notify = Boolean(row?.notified_at); row = null; return { notify }; }
      throw new Error(name);
    };
    const deps = { call, send: async (mail) => { mails.push(mail); return { ok: true }; } };
    await report("mira", { key: agent.alert_key, title: agent.title, detail: agent.detail, severity: "warning", ok: false }, deps);
    await notifyDue(deps);
    t.mock.timers.setTime(now + duration * 60_000);
    await notifyDue(deps);
    await report("mira", { key: agent.alert_key, label: "Agent", ok: true }, deps);
    assert.equal(mails.length, duration === 10 ? 0 : 2);
  }
});

test("n8n Netzfehler schließt vor Hold-Ablauf nur mit neuerem Erfolg und 10 ruhigen Minuten", () => {
  const raw = { health: { status: 200 }, api: { status: 200 }, workflows: [], schedules: [], queues: { send_waiting: 0, analysis_waiting: 0 }, openErrors: [workflow], errors: [{ key: workflow.alert_key, available: true, lastError: time(0), lastSuccess: time(1) }] };
  const first = evaluateN8n(raw, new Date(time(6)));
  const closed = (value, minutes) => evaluateN8n(value, new Date(time(minutes)), first).checks.some((c) => c.key === workflow.alert_key && c.ok === true);
  assert.equal(closed(raw, 9), false);
  assert.equal(closed(raw, 11), true);
  assert.equal(closed({ ...raw, errors: [{ ...raw.errors[0], available: false }] }, 19), false);
  assert.equal(closed({ ...raw, errors: [{ ...raw.errors[0], lastSuccess: null }] }, 19), false);
});
