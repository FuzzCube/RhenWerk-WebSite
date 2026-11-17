// Read bounded tails of n8n's JSON event logs, including the previous file at rotation.
// Output contains only completion timestamps, never workflow inputs, transcripts, credentials or SQLite data.
import { execFileSync } from "node:child_process";

const reader = `
const fs = require('node:fs');
for (const name of ['n8nEventLog-1.log', 'n8nEventLog.log']) {
  let fd;
  try {
    fd = fs.openSync('/home/node/.n8n/' + name, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, 2 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    const count = fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.subarray(0, count).toString('utf8').split('\\n');
    if (size > length) lines.shift();
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (['n8n.workflow.success', 'n8n.workflow.failed'].includes(e.eventName)) {
          console.log(JSON.stringify({ workflowId: e.payload?.workflowId, event: e.eventName, ts: e.ts }));
        }
      } catch { /* partial or malformed line */ }
    }
  } catch { /* missing rotated file or disabled event logging: no recovery evidence */ }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}`;

export function recentWorkflowEvents(env, workflowIds, { run = execFileSync } = {}) {
  try {
    const output = run("docker", ["exec", env.N8N_CONTAINER ?? "n8n", "node", "-e", reader], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
    });
    const wanted = new Set(workflowIds);
    const result = {};
    for (const line of output.split("\n")) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (!wanted.has(event.workflowId) || !Number.isFinite(Date.parse(event.ts))) continue;
      const field = event.event === "n8n.workflow.success" ? "lastSuccess" : event.event === "n8n.workflow.failed" ? "lastError" : null;
      if (!field) continue;
      const row = result[event.workflowId] ??= {};
      if (!row[field] || Date.parse(event.ts) > Date.parse(row[field])) row[field] = event.ts;
    }
    return result;
  } catch { return {}; }
}
