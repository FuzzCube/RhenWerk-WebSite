// Unit tests for the login pause helpers (task-11-6). Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { loginKey, pauseMessage, pauseText } from "../../lib/auth/throttle.ts";

test("Schlüssel: SHA-256 der normalisierten Adresse, Adresse nicht enthalten", () => {
  const key = loginKey(" Lea.Schneider@Example.com ");
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, loginKey("lea.schneider@example.com"));
  assert.notEqual(key, loginKey("lea.schneider@example.org"));
});

test("Wartezeit in Worten", () => {
  assert.equal(pauseText(30), "30 Sekunden");
  assert.equal(pauseText(0.4), "1 Sekunde");
  assert.equal(pauseText(60), "1 Minute");
  assert.equal(pauseText(61), "2 Minuten");
  assert.equal(pauseText(900), "15 Minuten");
  assert.equal(pauseMessage(120), "Zu viele Fehlversuche. Bitte in 2 Minuten erneut versuchen.");
});
