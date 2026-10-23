// Unit tests for unread customer messages (task-20-14). Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { isUnreadMessage, unreadText } from "../../lib/dashboard/unread.ts";

const message = (overrides = {}) => ({ direction: "incoming", staff_read_at: null, archived_at: null, received_at: "2026-10-23T10:00:00Z", created_at: "2026-10-23T10:00:05Z", ...overrides });

test("a customer e-mail after the request was created and not yet read is unread", () => {
  assert.equal(isUnreadMessage(message(), "2026-10-22T08:00:00Z"), true);
});

test("read, archived, outgoing and the e-mail the request was created from are not unread", () => {
  assert.equal(isUnreadMessage(message({ staff_read_at: "2026-10-23T11:00:00Z" }), "2026-10-22T08:00:00Z"), false);
  assert.equal(isUnreadMessage(message({ archived_at: "2026-10-23T11:00:00Z" }), "2026-10-22T08:00:00Z"), false);
  assert.equal(isUnreadMessage(message({ direction: "outgoing" }), "2026-10-22T08:00:00Z"), false);
  assert.equal(isUnreadMessage(message(), "2026-10-23T10:00:10Z"), false);
});

test("without received_at the creation time counts", () => {
  assert.equal(isUnreadMessage(message({ received_at: null }), "2026-10-23T10:00:00Z"), true);
});

test("text of the count", () => {
  assert.equal(unreadText(1), "1 ungelesene Nachricht vom Kunden");
  assert.equal(unreadText(3), "3 ungelesene Nachrichten vom Kunden");
});
