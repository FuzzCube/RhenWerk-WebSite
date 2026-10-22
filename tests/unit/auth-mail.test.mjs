// The website serves the e-mail templates of Supabase Auth on the VPS (task-18-4, GOTRUE_MAILER_TEMPLATES_* in
// ops/vps/docker-compose.yml); the copies under public/auth-mail must equal supabase/templates (local config.toml).
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Vorlagen der Passwort-Mails auf der Website entsprechen supabase/templates", () => {
  for (const name of ["passwort-zuruecksetzen.html", "passwort-geaendert.html"]) {
    assert.equal(readFileSync(`public/auth-mail/${name}`, "utf8"), readFileSync(`supabase/templates/${name}`, "utf8"), name);
  }
});
