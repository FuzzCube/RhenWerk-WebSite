// Unit tests for the messages of pg_restore --clean that a restore accepts (task-18-7, scripts/restore.mjs).
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { unexpectedRestoreErrors } from "../../scripts/restore.mjs";

test("erwartete Meldungen von pg_restore über eine Supabase-Datenbank, alles andere bricht ab", () => {
  const output = [
    "pg_restore: error: could not execute query: ERROR:  role \"supabase_realtime_admin\" does not exist",
    "pg_restore: error: could not execute query: ERROR:  schema \"storage\" already exists",
    "pg_restore: error: could not execute query: ERROR:  cannot drop inherited constraint \"messages_2026_10_20_pkey\" of relation \"messages_2026_10_20\"",
    "pg_restore: error: could not execute query: ERROR:  relation \"public.requests\" does not exist",
    "pg_restore: warning: errors ignored on restore: 4",
  ].join("\n");
  assert.deepEqual(unexpectedRestoreErrors(output), [output.split("\n")[3]]);
  assert.deepEqual(unexpectedRestoreErrors(""), []);
});
