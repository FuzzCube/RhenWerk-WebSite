import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { recentWorkflowEvents } from "../../scripts/ops/n8n-events.mjs";

test("Event-Log: nur abgeschlossene Workflows, neuestes Ereignis bei Rotation und ungültige Daten überspringen", () => {
  const lines = [
    { workflowId: "wanted", event: "n8n.workflow.success", ts: "2026-11-17T12:47:02+01:00" },
    { workflowId: "wanted", event: "n8n.workflow.success", ts: "2026-11-17T11:45:02Z" },
    { workflowId: "wanted", event: "n8n.workflow.failed", ts: "2026-11-12T12:23:17Z" },
    { workflowId: "other", event: "n8n.workflow.success", ts: "2026-11-17T12:00:00Z" },
    { workflowId: "wanted", event: "n8n.node.finished", ts: "2026-11-17T12:00:00Z" },
    { workflowId: "wanted", event: "n8n.workflow.success", ts: "invalid" },
  ].map((e) => JSON.stringify(e)).join("\n") + "\npartial";
  const result = recentWorkflowEvents({ N8N_CONTAINER: "rheinwerk-n8n" }, ["wanted"], { run: (cmd, args) => {
    assert.equal(cmd, "docker");
    assert.deepEqual(args.slice(0, 4), ["exec", "rheinwerk-n8n", "node", "-e"]);
    assert.doesNotMatch(args[4], /sqlite/i);
    return lines;
  } });
  assert.deepEqual(result, { wanted: { lastSuccess: "2026-11-17T12:47:02+01:00", lastError: "2026-11-12T12:23:17Z" } });
});

test("Fehlender Docker-Zugriff oder leeres Log liefert keinen Erfolgsnachweis", () => {
  assert.deepEqual(recentWorkflowEvents({}, ["wanted"], { run: () => { throw new Error("unavailable"); } }), {});
  assert.deepEqual(recentWorkflowEvents({}, ["wanted"], { run: () => "" }), {});
});


test("Echter JSON-Logleser verarbeitet Rotation, abgeschnittene Zeilen und begrenzte Dateiende", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rw-n8n-events-"));
  try {
    const event = (ts) => JSON.stringify({ eventName: "n8n.workflow.success", ts, payload: { workflowId: "wanted" } });
    writeFileSync(path.join(dir, "n8nEventLog-1.log"), event("2026-11-17T11:43:00Z") + "\n");
    writeFileSync(path.join(dir, "n8nEventLog.log"), "x".repeat(2 * 1024 * 1024 + 100) + "\n" + event("2026-11-17T11:47:00Z") + "\n{partial");
    const result = recentWorkflowEvents({}, ["wanted"], { run: (_cmd, args) => execFileSync(process.execPath,
      ["-e", args[4].replaceAll("/home/node/.n8n/", dir + "/")], { encoding: "utf8" }) });
    assert.deepEqual(result, { wanted: { lastSuccess: "2026-11-17T11:47:00Z" } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
