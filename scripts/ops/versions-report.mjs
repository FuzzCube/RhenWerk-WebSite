// Versions for the area "System" (task-17-15) into system_status.dependency_updates; nightly run, "System prüfen" and
// every deployment (ops/vps/migrate.sh). New server images send the e-mail "Update bereit" once (task-29-1).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sendAlert } from "../lib/notify.mjs";
import { DASHBOARD, LOG_DIR, rpc } from "./lib.mjs";
import { collectVersions, updateReadyMail, versionRows } from "./versions.mjs";

const READY_FILE = path.join(LOG_DIR, "update-ready.txt");

export async function refreshVersions() {
  const raw = await collectVersions();
  const rows = versionRows(raw);
  await rpc("set_system_status", { payload: { dependency_updates: { checked_at: new Date().toISOString(), versions: rows } } });
  if (raw.server) await notifyUpdateReady(rows);
}

async function notifyUpdateReady(rows) {
  const last = existsSync(READY_FILE) ? readFileSync(READY_FILE, "utf8").trim() : null;
  const { key, mail } = updateReadyMail(rows, last);
  if (!key) { rmSync(READY_FILE, { force: true }); return; }
  if (!mail) return;
  const sent = await sendAlert({ subject: mail.subject, text: `${mail.text}\n\n${DASHBOARD}` });
  if (sent.ok) { mkdirSync(LOG_DIR, { recursive: true }); writeFileSync(READY_FILE, `${key}\n`); }
}
