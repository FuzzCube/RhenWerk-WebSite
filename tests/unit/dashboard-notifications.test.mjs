import test from "node:test";
import assert from "node:assert/strict";
import { callbackEvent, freshDashboardEvents } from "../../lib/dashboard-notifications.ts";

test("same unread request total, different message IDs: both replies notify once", () => {
  const first = { id: "message:first", title: "Neue Kundenantwort", href: "/dashboard/anfragen/a" };
  const second = { ...first, id: "message:second" };
  const seen = new Set(["message:old"]); // silent initial baseline
  assert.deepEqual(freshDashboardEvents([first], seen), [first]);
  assert.deepEqual(freshDashboardEvents([first, second], seen), [second]);
  assert.deepEqual(freshDashboardEvents([first, second], seen), []);
});

test("processed or dismissed events stay seen when they reappear after reconnection", () => {
  const event = { id: "event:cancelled", title: "Termin storniert", href: "/dashboard/planung?anfrage=a" };
  const seen = new Set();
  assert.equal(freshDashboardEvents([event, event], seen).length, 1);
  assert.deepEqual(freshDashboardEvents([], seen), []);
  assert.deepEqual(freshDashboardEvents([event], seen), []);
});

test("callback namespaces and links respect role and callback kind", () => {
  const visit = { kind: "visit", id: "same-id", visit_id: "v", request_id: "r" };
  const call = { kind: "call", id: "same-id" };
  assert.equal(callbackEvent(visit, "technician").href, "/dashboard/einsatz/v");
  assert.equal(callbackEvent(visit, "dispatcher").href, "/dashboard/anfragen/r");
  assert.equal(callbackEvent(call, "dispatcher").href, "/dashboard/anrufe/same-id");
  assert.notEqual(callbackEvent(visit, "dispatcher").id, callbackEvent(call, "dispatcher").id);
});
