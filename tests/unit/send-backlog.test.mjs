// Unit tests for the hint on e-mails waiting for the Gmail dispatch (task-12-9).
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { sendBacklogText } from "../../lib/send-backlog.ts";

const now = new Date("2026-10-20T12:00:00Z");

test("Kein Hinweis ohne wartende E-Mails", () => {
  assert.equal(sendBacklogText({ waiting: 0, oldestAt: null }, now), null);
  assert.equal(sendBacklogText({ waiting: 2, oldestAt: null }, now), null);
});

test("Anzahl und Wartezeit der ältesten E-Mail", () => {
  assert.equal(sendBacklogText({ waiting: 1, oldestAt: "2026-10-20T11:47:30Z" }, now), "1 E-Mail wartet seit 12 min auf den Versand.");
  assert.equal(sendBacklogText({ waiting: 3, oldestAt: "2026-10-20T09:40:00Z" }, now), "3 E-Mails warten seit 2 h 20 min auf den Versand.");
  assert.equal(sendBacklogText({ waiting: 5, oldestAt: "2026-10-19T08:42:00Z" }, now), "5 E-Mails warten seit 1 T 3 h auf den Versand.");
});

test("Uhrzeit des Servers leicht voraus: keine negative Wartezeit", () => {
  assert.equal(sendBacklogText({ waiting: 1, oldestAt: "2026-10-20T12:00:30Z" }, now), "1 E-Mail wartet seit 0 min auf den Versand.");
});
