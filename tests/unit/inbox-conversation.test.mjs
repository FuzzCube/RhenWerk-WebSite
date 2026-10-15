import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationState, replySubject, replyTemplate } from "../../lib/inbox-conversation.ts";

const row = (direction, status, at) => ({ direction, status, received_at: direction === "incoming" ? at : null, created_at: at });

test("conversation state follows the latest message", () => {
  assert.deepEqual(conversationState("2026-10-15T08:00:00Z", []), { state: "new", last_at: "2026-10-15T08:00:00Z" });
  assert.equal(conversationState(null, [row("outgoing", "queued", "2026-10-15T09:00:00Z")]).state, "queued");
  assert.equal(conversationState(null, [row("outgoing", "sent", "2026-10-15T09:00:00Z")]).state, "answered");
  assert.equal(conversationState(null, [row("outgoing", "failed", "2026-10-15T09:00:00Z")]).state, "failed");
  const answered = conversationState(null, [row("incoming", "received", "2026-10-15T10:00:00Z"), row("outgoing", "sent", "2026-10-15T09:00:00Z")]);
  assert.deepEqual(answered, { state: "replied", last_at: "2026-10-15T10:00:00Z" });
  // A second customer e-mail before any reply is still new
  assert.equal(conversationState(null, [row("incoming", "received", "2026-10-15T10:00:00Z")]).state, "new");
});

test("reply subject does not stack prefixes", () => {
  assert.equal(replySubject("Frage zu unserem Auftrag"), "AW: Frage zu unserem Auftrag");
  assert.equal(replySubject("AW: Re: Frage"), "AW: Frage");
  assert.equal(replySubject("  "), "AW: Ihre Nachricht");
  assert.ok(replySubject("x".repeat(300)).length <= 200);
});

test("reply template asks for the details and is signed", () => {
  const text = replyTemplate("Lea Schneider");
  for (const part of ["Anfragenummer", "Firma und Standort", "Telefonnummer", "Lea Schneider", "RheinWerk Industrieservice"]) assert.ok(text.includes(part), part);
});
