// Unit tests for the website assistant (task-18-10, lib/assistant.ts): checks of a question, answer of the workflow
// and the limit per visitor of /api/assistant.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantAnswer, createRateLimiter, parseAssistantRequest } from "../../lib/assistant.ts";

const session = "0b7c2d4e-8f1a-4c3b-9d2e-5f6a7b8c9d0e";

test("Frage: Leerzeichen zusammengefasst, 1–500 Zeichen, Sitzung als UUID", () => {
  assert.deepEqual(parseAssistantRequest({ question: "  Was kostet\n eine Inspektion? ", session_id: session.toUpperCase() }),
    { ok: true, question: "Was kostet eine Inspektion?", sessionId: session });
  assert.equal(parseAssistantRequest({ question: "   ", session_id: session }).ok, false);
  assert.equal(parseAssistantRequest({ question: "x".repeat(501), session_id: session }).ok, false);
  assert.equal(parseAssistantRequest({ question: "x".repeat(500), session_id: session }).ok, true);
  assert.equal(parseAssistantRequest({ question: "Hallo", session_id: "rheinwerk-test" }).ok, false, "fester Schlüssel wie auf Oracle abgelehnt");
  assert.equal(parseAssistantRequest({ question: 42, session_id: session }).ok, false);
  assert.equal(parseAssistantRequest(null).ok, false);
});

test("Antwort des Workflows: nur Text, gekürzt, sonst null", () => {
  assert.equal(assistantAnswer({ answer: "  Eine Inspektion kostet 189 €. " }), "Eine Inspektion kostet 189 €.");
  assert.equal(assistantAnswer({ answer: "x".repeat(5000) }).length, 4000);
  assert.equal(assistantAnswer({ answer: "" }), null);
  assert.equal(assistantAnswer({ output: "x" }), null);
  assert.equal(assistantAnswer(null), null);
});

test("Begrenzung: 20 Fragen je Besucher in 10 Minuten, danach wieder frei", () => {
  const limited = createRateLimiter(20, 600_000);
  const results = Array.from({ length: 21 }, () => limited("1.2.3.4", 1000));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.at(-1), true);
  assert.equal(limited("5.6.7.8", 1000), false, "andere Besucher unabhängig");
  assert.equal(limited("1.2.3.4", 1000 + 600_000), false, "neues Zeitfenster");
});
