// Unit tests for the password rules and the reset-session check (task-11-5). Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { isFreshRecovery, MIN_PASSWORD_LENGTH, newPasswordErrors } from "../../lib/auth/password.ts";

test("Neues Passwort: Länge, Ränder, Wiederholung, anders als bisher", () => {
  const ok = "Sicheres-Passwort-1";
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.deepEqual(newPasswordErrors(ok, ok), {});
  assert.deepEqual(Object.keys(newPasswordErrors("kurz", "kurz")), ["password"]);
  assert.deepEqual(Object.keys(newPasswordErrors(` ${ok}`, ` ${ok}`)), ["password"]);
  assert.deepEqual(Object.keys(newPasswordErrors(ok, `${ok}x`)), ["password_repeat"]);
  assert.deepEqual(Object.keys(newPasswordErrors(ok, ok, ok)), ["password"]);
  assert.deepEqual(newPasswordErrors(ok, ok, "Altes-Passwort-1"), {});
});

test("Nur eine frische Link-Sitzung darf ohne aktuelles Passwort setzen", () => {
  const now = 1_800_000_000;
  assert.equal(isFreshRecovery([{ method: "otp", timestamp: now - 60 }], now), true);
  assert.equal(isFreshRecovery([{ method: "recovery", timestamp: now - 3600 }], now), true);
  assert.equal(isFreshRecovery([{ method: "otp", timestamp: now - 3601 }], now), false);
  assert.equal(isFreshRecovery([{ method: "password", timestamp: now - 10 }], now), false);
  assert.equal(isFreshRecovery(undefined, now), false);
});
