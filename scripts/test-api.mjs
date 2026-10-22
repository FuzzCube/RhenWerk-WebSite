// Direct API checks against the local Supabase stack (REST, RPC, Storage) with real logins.
// Covers foreign-role access (scenario 1), concurrent bookings and booking vs. availability races (scenario 2).
// Usage: npm run test:api   (requires `supabase start` and .env.local)
// Each run creates its own users and records (suffix = run id). The users are deactivated at the end; `npm run demo:seed`
// removes them together with the test records.
import { createClient } from "@supabase/supabase-js";
import { deactivateTestAccounts } from "./demo/test-accounts.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !publishableKey || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY und SUPABASE_SECRET_KEY werden benötigt.");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
  console.error(`Abbruch: test:api läuft nur gegen den lokalen Stack, nicht gegen ${url}.`);
  process.exit(1);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secretKey, options);
const runId = Date.now().toString(36);
const password = `Api-Test-${runId}-Passwort`;
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` – ${detail}`}`);
  if (!ok) failures += 1;
}

function denied(result) {
  return Boolean(result.error) && ["42501", "PGRST301"].includes(result.error.code);
}

async function must(promise) {
  const result = await promise;
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const createdAccounts = [];

async function createEmployee(key, role, isActive = true) {
  const email = `api-${key}-${runId}@example.com`;
  const user = await must(admin.auth.admin.createUser({ email, password, email_confirm: true }));
  await must(admin.from("profiles").insert({ id: user.user.id, display_name: `API ${key}`, role, is_active: isActive }));
  createdAccounts.push(user.user.id);
  const client = createClient(url, publishableKey, options);
  await must(client.auth.signInWithPassword({ email, password }));
  return { id: user.user.id, client };
}

async function createRequest(key, dispatcherId, technicianId = null) {
  return must(
    admin
      .from("requests")
      .insert({
        source_event_key: `api-${key}-${runId}`,
        request_number: "wird-ersetzt",
        source: "demo_seed",
        is_demo: true,
        company_name: `API Kunde ${key}`,
        contact_name: "Erika Muster",
        business_email: `kunde-${key}@example.com`,
        phone_number: "+49 211 000000",
        street_house_number: "Werkstr. 1",
        postal_code: "40210",
        city: "Düsseldorf",
        equipment_kind: "pump",
        service_kind: "diagnosis_repair",
        requested_visit_date: "2027-03-01",
        description: "API-Test",
        customer_urgency: "planbar",
        safety_risk: "none_known",
        raw_payload: { test: runId },
        dispatcher_id: dispatcherId,
        technician_id: technicianId,
        intake_status: "processed",
        priority: "normal",
        intake_completed_at: new Date().toISOString(),
        intake_mode: "manual",
        manual_minutes_baseline: 5,
      })
      .select()
      .single(),
  );
}

async function workingHours(technicianId) {
  const rows = [1, 2, 3, 4, 5].map((weekday) => ({
    employee_id: technicianId,
    kind: "working_hours",
    weekday,
    local_start: "07:00",
    local_end: "16:00",
  }));
  await must(admin.from("employee_availability").insert(rows));
}

// Monday 2027-03-01 + week offset, local time Europe/Berlin (UTC+1 in March before DST)
function slot(weekOffset, startHour, hours = 1) {
  const day = new Date(Date.UTC(2027, 2, 1 + weekOffset * 7));
  const start = new Date(day.getTime() + (startHour - 1) * 3600_000);
  const end = new Date(start.getTime() + hours * 3600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

console.log(`API-Prüfung gegen ${url} (Lauf ${runId})\n`);

// Setup
const dispatcherA = await createEmployee("dispo-a", "dispatcher");
const dispatcherB = await createEmployee("dispo-b", "dispatcher");
const inactive = await createEmployee("inaktiv", "dispatcher", false);
const manager = await createEmployee("manager", "manager");
const technicianA = await createEmployee("technik-a", "technician");
const technicianB = await createEmployee("technik-b", "technician");
await workingHours(technicianA.id);
await workingHours(technicianB.id);

const requestA = await createRequest("a", dispatcherA.id, technicianA.id);
const requestB = await createRequest("b", dispatcherB.id, technicianB.id);
const visitA = await must(
  dispatcherA.client.rpc("schedule_visit", {
    request_id: requestA.id,
    expected_version: 1,
    technician_id: technicianA.id,
    scheduled_start: slot(0, 8).start,
    scheduled_end: slot(0, 8, 2).end,
  }),
);
const filePath = `api-${runId}/auftrag-a.pdf`;
await must(admin.storage.from("dashboard").upload(filePath, new Blob(["%PDF-1.4 Demo"], { type: "application/pdf" })));
await must(
  admin.from("attachments").insert({
    request_id: requestA.id,
    bucket: "dashboard",
    storage_path: filePath,
    file_name: "auftrag-a.pdf",
    mime_type: "application/pdf",
    size_bytes: 13,
  }),
);

console.log("Szenario 1: Zugriff fremder Rollen über die API");
const anon = createClient(url, publishableKey, options);
check("anon liest keine Anfragen", denied(await anon.from("requests").select("id")));
check("anon ruft keine Operation auf", denied(await anon.rpc("complete_intake", { request_id: requestA.id, expected_version: 1 })));
check("anon lädt keine Datei", Boolean((await anon.storage.from("dashboard").download(filePath)).error));

const foreignRead = await technicianB.client.from("requests").select("id").eq("id", requestA.id);
check("Techniker B liest Anfrage von A nicht", !foreignRead.error && foreignRead.data.length === 0);
const foreignFile = await technicianB.client.from("attachments").select("id").eq("request_id", requestA.id);
check("Techniker B sieht Dokument-Metadaten von A nicht", !foreignFile.error && foreignFile.data.length === 0);
check("Techniker B lädt Dokument von A nicht", Boolean((await technicianB.client.storage.from("dashboard").download(filePath)).error));
check("Techniker A lädt eigenes Dokument", !(await technicianA.client.storage.from("dashboard").download(filePath)).error);
check(
  "Techniker B startet Einsatz von A nicht",
  denied(await technicianB.client.rpc("start_visit", { visit_id: visitA.id, expected_version: 3 })),
);
check(
  "Techniker B ändert Anfrage von A nicht per PATCH",
  denied(await technicianB.client.from("requests").update({ priority: "critical" }).eq("id", requestA.id)),
);
check(
  "Techniker kann Autor/Arbeitsposition nicht direkt einfügen",
  denied(
    await technicianA.client.from("work_entries").insert({
      request_id: requestA.id,
      author_id: manager.id,
      kind: "labor",
      description: "gefälscht",
      quantity: 1,
      unit: "hour",
      unit_price: 1,
      tax_rate: 19,
    }),
  ),
);
check(
  "Techniker befördert sich nicht selbst",
  denied(await technicianA.client.from("profiles").update({ role: "admin" }).eq("id", technicianA.id)),
);
const roleAfter = await must(admin.from("profiles").select("role").eq("id", technicianA.id).single());
check("Rolle unverändert", roleAfter.role === "technician");

const dispatcherRead = await dispatcherA.client.from("requests").select("id").eq("id", requestB.id);
check("Dispatcher A liest Anfrage von B nicht", !dispatcherRead.error && dispatcherRead.data.length === 0);
check(
  "Dispatcher A ändert Anfrage von B nicht",
  denied(await dispatcherA.client.rpc("mark_needs_review", { request_id: requestB.id, expected_version: 1 })),
);
check(
  "Inaktives Profil handelt nicht",
  denied(await inactive.client.rpc("mark_needs_review", { request_id: requestA.id, expected_version: 3 })),
);
check(
  "Manager bestätigt keinen E-Mail-Versand (nur Integration)",
  denied(await manager.client.rpc("confirm_message_sent", { message_id: visitA.id })),
);

console.log("\nSzenario 2: Gleichzeitige Buchungen über HTTP");
const parallelRequests = await Promise.all(
  Array.from({ length: 10 }, (_, i) => createRequest(`parallel-${i}`, dispatcherA.id)),
);
const bookingSlot = slot(1, 8, 2);
const bookings = await Promise.all(
  parallelRequests.map((request) =>
    dispatcherA.client.rpc("schedule_visit", {
      request_id: request.id,
      expected_version: 1,
      technician_id: technicianB.id,
      scheduled_start: bookingSlot.start,
      scheduled_end: bookingSlot.end,
    }),
  ),
);
const booked = bookings.filter((result) => !result.error).length;
const conflicts = bookings.filter((result) => result.error?.code === "RW410").length;
check("10 gleichzeitige Buchungen desselben Zeitfensters: genau 1 erfolgreich", booked === 1, `erfolgreich: ${booked}`);
check("übrige 9 erhalten Terminkonflikt RW410", conflicts === 9, `RW410: ${conflicts}`);

const raceRequests = await Promise.all(
  Array.from({ length: 10 }, (_, i) => createRequest(`race-${i}`, dispatcherA.id)),
);
let bothSucceeded = 0;
let neitherSucceeded = 0;
for (let i = 0; i < raceRequests.length; i += 1) {
  const raceSlot = slot(2 + i, 9);
  const [booking, absence] = await Promise.all([
    dispatcherA.client.rpc("schedule_visit", {
      request_id: raceRequests[i].id,
      expected_version: 1,
      technician_id: technicianB.id,
      scheduled_start: raceSlot.start,
      scheduled_end: raceSlot.end,
    }),
    admin.from("employee_availability").insert({
      employee_id: technicianB.id,
      kind: "absence",
      starts_at: raceSlot.start,
      ends_at: raceSlot.end,
      label: "Parallel eingetragen",
    }),
  ]);
  if (!booking.error && !absence.error) bothSucceeded += 1;
  if (booking.error && absence.error) neitherSucceeded += 1;
}
check("Buchung und gleichzeitige Abwesenheit nie beide erfolgreich (10 Durchläufe)", bothSucceeded === 0, `beide: ${bothSucceeded}`);
check("jeweils genau eine Seite erfolgreich", neitherSucceeded === 0, `keine: ${neitherSucceeded}`);


// task-17-7/17-12: area "System". Manager and admin read; code updates are no longer requested from the dashboard,
// so even admin is refused (nothing reaches the service on the host, which shares the database).
console.log("\nSystem: Updates und Warnungen");
{
  const systemAdmin = await createEmployee("system-admin", "admin");
  check("Admin: request_update abgewiesen (task-17-12)", denied(await systemAdmin.client.rpc("request_update")));
  check("Admin: request_rollback abgewiesen (task-17-12)", denied(await systemAdmin.client.rpc("request_rollback", { target_commit: "0".repeat(40) })));
  check("Admin liest offene Warnungen", !(await systemAdmin.client.from("system_alerts").select("id").is("resolved_at", null)).error);
  const status = async (client) => (await client.from("system_status").select("id")).data?.length ?? 0;
  check("Manager liest den Systemstatus", (await status(manager.client)) === 1);
  check("Dispatcher und Techniker sehen keinen Systemstatus", (await status(dispatcherA.client)) === 0 && (await status(technicianA.client)) === 0);
  check("Manager: request_update abgewiesen", denied(await manager.client.rpc("request_update")));
  check("Manager: request_rollback abgewiesen", denied(await manager.client.rpc("request_rollback", { target_commit: "0".repeat(40) })));
  check("Dispatcher: request_update abgewiesen", denied(await dispatcherA.client.rpc("request_update")));
  check("Manager: resolve_alert abgewiesen", denied(await manager.client.rpc("resolve_alert", { alert_id: "00000000-0000-0000-0000-000000000000" })));
  check("Manager: raise_alert der Skripte abgewiesen", denied(await manager.client.rpc("raise_alert", { source: "app", alert_key: "test", severity: "warning", title: "x" })));
  check("Manager: kein direktes Anlegen von Anfragen", denied(await manager.client.from("update_requests").insert({ action: "update", requested_by: manager.id })));

  // task-17-10: warning of a script, seen by manager and admin, closed by admin only. Marked as mailed at once, so that
  // the running watchdog does not send an e-mail for it; removed at the end.
  const key = `api-test:${Date.now()}`;
  const raised = await admin.rpc("raise_alert", { source: "app", alert_key: key, severity: "warning", title: "API-Testwarnung" });
  await admin.rpc("mark_alert_notified", { alert_id: raised.data.alert_id });
  const visible = async (client) => (await client.from("system_alerts").select("id").eq("alert_key", key)).data?.length ?? 0;
  check("Warnung: Manager und Admin sehen sie, Dispatcher und Techniker nicht",
    (await visible(manager.client)) === 1 && (await visible(systemAdmin.client)) === 1 && (await visible(dispatcherA.client)) === 0 && (await visible(technicianA.client)) === 0);
  check("Manager: Erledigen abgewiesen", denied(await manager.client.rpc("resolve_alert", { alert_id: raised.data.alert_id })));
  const resolved = await systemAdmin.client.rpc("resolve_alert", { alert_id: raised.data.alert_id });
  check("Admin erledigt die Warnung (manual, mit Person)", !resolved.error && resolved.data?.resolved_reason === "manual" && resolved.data?.resolved_by === systemAdmin.id, resolved.error?.message);
  check("  zweites Erledigen: RW422", (await systemAdmin.client.rpc("resolve_alert", { alert_id: raised.data.alert_id })).error?.code === "RW422");
  await admin.from("system_alerts").delete().eq("alert_key", key);

  // task-18-6: backups. Manager reads the list but cannot start one (42501); admin files "Jetzt sichern" once (RW422
  // for a second request); only the service records backups. The request is cleared at the end so that the service
  // on the VPS never sees it (the test runs against the local stack).
  check("Manager liest die Sicherungen", !(await manager.client.from("backups").select("id").limit(1)).error);
  check("Dispatcher sieht keine Sicherungen", ((await dispatcherA.client.from("backups").select("id")).data ?? []).length === 0);
  check("Manager: Jetzt sichern abgewiesen (42501)", (await manager.client.rpc("request_backup")).error?.code === "42501");
  check("Manager: record_backup abgewiesen", denied(await manager.client.rpc("record_backup", { reason: "manual", status: "ok", started_at: new Date().toISOString(), file_name: "x", size_bytes: 1, contents: {}, verified: true, error: null })));
  await admin.from("system_status").update({ backup_requested_at: null, backup_requested_by: null, backup_started_at: null }).eq("id", 1);
  const backupRequest = await systemAdmin.client.rpc("request_backup");
  check("Admin fordert eine Sicherung an", !backupRequest.error && backupRequest.data?.backup_requested_by === systemAdmin.id, backupRequest.error?.message);
  check("  zweite Anforderung: RW422", (await systemAdmin.client.rpc("request_backup")).error?.code === "RW422");
  await admin.from("system_status").update({ backup_requested_at: null, backup_requested_by: null, backup_started_at: null }).eq("id", 1);

  // task-18-10: the assistant's knowledge base only for service_role (n8n); the website asks through /api/assistant
  const vector = `[${Array(3072).fill(0.1).join(",")}]`;
  const anonClient = createClient(url, publishableKey, options);
  check("Wissensbasis: anon liest nichts", denied(await anonClient.from("rag_documents").select("id").limit(1)));
  check("Wissensbasis: Admin liest nichts", denied(await systemAdmin.client.from("rag_documents").select("id").limit(1)));
  check("Wissensbasis: Suche nur für den Dienst", denied(await anonClient.rpc("match_rag_documents", { query_embedding: vector, match_count: 1 }))
    && !(await admin.rpc("match_rag_documents", { query_embedding: vector, match_count: 1 })).error);
}

// task-18-10: /api/assistant checks the question before anything goes to n8n (needs the running app, APP_URL)
console.log("\nWebsite-Assistent: /api/assistant");
{
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const ask = (body) => fetch(`${app}/api/assistant`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  let reachable = true;
  try { await fetch(app, { signal: AbortSignal.timeout(5000) }); } catch { reachable = false; }
  if (!reachable) {
    console.log(`  übersprungen: App unter ${app} nicht erreichbar (npm run dev)`);
  } else {
    const session = crypto.randomUUID();
    const empty = await ask({ question: "   ", session_id: session });
    check("Leere Frage: 400 mit Hinweis", empty.status === 400 && (await empty.json()).message === "Bitte eine Frage eingeben.");
    check("Zu lange Frage: 400", (await ask({ question: "x".repeat(501), session_id: session })).status === 400);
    check("Feste Sitzung wie früher (rheinwerk-test): 400", (await ask({ question: "Hallo", session_id: "rheinwerk-test" })).status === 400);
    check("Kein JSON: 400", (await ask("kein json")).status === 400);
  }
}

await deactivateTestAccounts(admin, createdAccounts);

console.log(`\n${failures === 0 ? "Alle API-Prüfungen bestanden." : `${failures} Prüfung(en) fehlgeschlagen.`}`);
process.exit(failures === 0 ? 0 : 1);
