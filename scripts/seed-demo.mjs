// Demo data seed: about 600 requests over 24 months with full chronology (spec section 9).
// Usage:
//   npm run demo:users            (once: demo staff)
//   npm run demo:seed             replace demo data (idempotent)
//   npm run demo:seed -- --purge  remove demo data only
// Optional: DEMO_SEED_ANCHOR=YYYY-MM-DD (default: today, Europe/Berlin).
//
// The data is generated deterministically from the anchor and written by public.demo_seed_apply in a single
// transaction that first removes previous demo data. Live data (is_demo = false, users without demo marker)
// is never touched. No e-mails are sent. Accounts of automated test runs (scripts/demo/test-accounts.mjs) are
// removed afterwards; still referenced ones are deactivated and blocked.
import { readdir, readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { DEMO_SEED_OWNER, DEMO_STAFF } from "./demo/staff.mjs";
import { generateDemoData } from "./demo/generate.mjs";
import { cleanupTestAccounts } from "./demo/test-accounts.mjs";
import { berlinTime, isoDate } from "./demo/time.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SECRET_KEY werden benötigt.");
  process.exit(1);
}
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url);
if (!isLocal && process.env.DEMO_BOOTSTRAP_ALLOW_REMOTE !== "1") {
  console.error(`Abbruch: ${url} ist kein lokaler Stack. Für ein Remote-Projekt DEMO_BOOTSTRAP_ALLOW_REMOTE=1 setzen.`);
  process.exit(1);
}

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const BUCKET = "dashboard";
const FILE_PREFIX = "demo";

// Demo files live under dashboard/demo/<request_id>/; additionally visit photos of demo requests are removed
async function removeDemoFiles() {
  const { data: folders, error } = await admin.storage.from(BUCKET).list(FILE_PREFIX, { limit: 1000 });
  if (error) throw new Error(`Storage: ${error.message}`);
  let removed = 0;
  for (const folder of folders) {
    const { data: files } = await admin.storage.from(BUCKET).list(`${FILE_PREFIX}/${folder.name}`, { limit: 1000 });
    const paths = (files ?? []).map((file) => `${FILE_PREFIX}/${folder.name}/${file.name}`);
    if (paths.length > 0) {
      const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
      if (removeError) throw new Error(`Storage: ${removeError.message}`);
      removed += paths.length;
    }
  }
  // Visit photos of demo requests (e.g. from test:ui) under visits/<request_id>/<visit_id>/
  const { data: demoRequests } = await admin.from("requests").select("id").eq("is_demo", true).range(0, 99999);
  const demoIds = new Set((demoRequests ?? []).map((request) => request.id));
  const { data: requestFolders } = await admin.storage.from(BUCKET).list("visits", { limit: 1000 });
  for (const requestFolder of requestFolders ?? []) {
    if (!demoIds.has(requestFolder.name)) continue;
    const { data: visitFolders } = await admin.storage.from(BUCKET).list(`visits/${requestFolder.name}`, { limit: 1000 });
    for (const visitFolder of visitFolders ?? []) {
      const prefix = `visits/${requestFolder.name}/${visitFolder.name}`;
      const { data: files } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
      const paths = (files ?? []).map((file) => `${prefix}/${file.name}`);
      if (paths.length > 0) {
        const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
        if (removeError) throw new Error(`Storage: ${removeError.message}`);
        removed += paths.length;
      }
    }
  }
  return removed;
}

// Demo service contracts (task-13-9) live outside demo_seed_apply: replaced as a whole, live contracts stay
async function replaceDemoContracts(contracts) {
  const { error: deleteError } = await admin.from("service_contracts").delete().eq("is_demo", true);
  if (deleteError) throw new Error(`Verträge: ${deleteError.message}`);
  if (contracts.length === 0) return 0;
  const { error: insertError } = await admin.from("service_contracts").insert(contracts);
  if (insertError) throw new Error(`Verträge: ${insertError.message}`);
  return contracts.length;
}

// Demo customers (task-13-10): replaced as a whole after the requests, then linked by customer number
async function replaceDemoCustomers(customers) {
  const { data, error } = await admin.rpc("demo_seed_customers", { customers });
  if (error) throw new Error(`Kunden: ${error.message}`);
  return data;
}

// Demo calls of the phone assistant (task-13-7): replaced as a whole after the customers; the customer number of a
// recognized caller becomes customer_id (main site). Live calls (is_demo false) stay.
async function replaceDemoCalls(calls) {
  const { error: deleteError } = await admin.from("phone_calls").delete().eq("is_demo", true);
  if (deleteError) throw new Error(`Anrufe: ${deleteError.message}`);
  if (calls.length === 0) return 0;
  const { data: known, error: customerError } = await admin.from("customers").select("id, customer_number, customer_sites(id, is_active, created_at)").eq("is_demo", true);
  if (customerError) throw new Error(`Anrufe: ${customerError.message}`);
  const byNumber = new Map((known ?? []).map((c) => [c.customer_number, c]));
  const rows = calls.map(({ customer_number: number, ...call }) => {
    const customer = number ? byNumber.get(number) : null;
    const site = customer?.customer_sites.filter((item) => item.is_active).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return { ...call, customer_id: customer?.id ?? null, customer_site_id: site?.id ?? null };
  });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from("phone_calls").insert(rows.slice(i, i + 200));
    if (error) throw new Error(`Anrufe: ${error.message}`);
  }
  return rows.length;
}

if (process.argv.includes("--purge")) {
  const files = await removeDemoFiles();
  const { data, error } = await admin.rpc("demo_seed_purge");
  if (error) throw new Error(error.message);
  await replaceDemoContracts([]);
  await replaceDemoCalls([]);
  await replaceDemoCustomers([]);
  console.log("Demodaten entfernt:", { ...data, storage_files: files });
  console.log("Testkonten:", await cleanupTestAccounts(admin));
  process.exit(0);
}

// Demo staff must exist (npm run demo:users)
const users = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw new Error(error.message);
  users.push(...data.users);
  if (data.users.length < 200) break;
}
const idOf = (key) => {
  const member = DEMO_STAFF.find((m) => m.key === key);
  const user = users.find((u) => u.email === member.email && u.app_metadata?.demo_seed === DEMO_SEED_OWNER);
  if (!user) {
    console.error(`Demo-Nutzer ${member.email} fehlt. Zuerst npm run demo:users ausführen.`);
    process.exit(1);
  }
  return user.id;
};
const staff = {
  admin: idOf("admin"),
  manager: idOf("manager"),
  dispatchers: ["dispatcher-1", "dispatcher-2", "dispatcher-3"].map(idOf),
  technicians: ["technician-1", "technician-2", "technician-3"].map(idOf),
};

const anchorText = process.env.DEMO_SEED_ANCHOR;
let anchor = new Date();
if (anchorText) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorText);
  if (!match) {
    console.error("DEMO_SEED_ANCHOR muss das Format JJJJ-MM-TT haben.");
    process.exit(1);
  }
  anchor = berlinTime(Number(match[1]), Number(match[2]), Number(match[3]), 12, 0);
}

// Live visits (not cancelled) block the demo calendar, so demo and live data never overlap
const { data: liveVisits, error: liveError } = await admin.from("visits").select("technician_id, scheduled_start, scheduled_end, requests!inner(is_demo)").eq("requests.is_demo", false).neq("status", "cancelled").range(0, 99999);
if (liveError) throw new Error(`Einsätze: ${liveError.message}`);
const { payload, cutoff, rateChange } = generateDemoData({ anchor, now: new Date(), staff, liveVisits });
console.log(`Seed-Anker ${isoDate(anchor)}, Stichzeitpunkt ${cutoff.toISOString()}, Tarifwechsel ${isoDate(rateChange)}`);

const removedFiles = await removeDemoFiles();
const { customers, phone_calls: phoneCalls, ...seedPayload } = payload;
const { data, error } = await admin.rpc("demo_seed_apply", { payload: seedPayload });
if (error) {
  console.error("Seed fehlgeschlagen:", error.message, error.details ?? "", error.hint ?? "");
  process.exit(1);
}
console.log("Entfernt:", { ...data.purged, storage_files: removedFiles });
console.log("Eingefügt:", { ...data.inserted, service_contracts: await replaceDemoContracts(payload.service_contracts), kunden: await replaceDemoCustomers(customers), anrufe: await replaceDemoCalls(phoneCalls) });

// Safe demo files (scripts/demo/files) attached to selected demo cases
const caseRequest = (demoCase) => payload.requests.find((r) => r.raw_payload.demo_case === demoCase);
const firstVisit = (request) => payload.visits.filter((v) => v.request_id === request.id).sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start))[0];
// Files are found by base name, so a replacement may use any allowed extension (.pdf, .jpg, .jpeg, .png)
const attachmentsPlan = [
  { demoCase: "Bestellte Teile und Folgeeinsatz", file: "foto-gleitringdichtung", visibility: "operational", parent: "visit" },
  { demoCase: "Sichere automatische Bearbeitung", file: "wartungsprotokoll-kompressor", visibility: "operational", parent: "visit" },
  { demoCase: "Technischer Fehler der Analyse", file: "pruefbericht-pumpe", visibility: "operational", parent: "visit" },
  { demoCase: "Rückfrage und Kundenantwort", file: "typenschild-pumpe", visibility: "dispatch", parent: "reply" },
  { demoCase: "Abgeschlossen mit offener Rechnung", file: "interne-notiz-forderung", visibility: "management", parent: "invoice" },
  { demoCase: "Prüfung offen mit E-Mail-Entwurf", file: "foto-lueftungsanlage", visibility: "operational", parent: "request" },
];
const MIME_TYPES = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
const filesDir = new URL("./demo/files/", import.meta.url);
const available = await readdir(filesDir);
function demoFile(base) {
  const name = available.find((entry) => {
    const dot = entry.lastIndexOf(".");
    return entry.slice(0, dot) === base && entry.slice(dot).toLowerCase() in MIME_TYPES;
  });
  if (!name) throw new Error(`Demo-Datei ${base}.(pdf|jpg|jpeg|png) fehlt in scripts/demo/files/`);
  return { name, mime: MIME_TYPES[name.slice(name.lastIndexOf(".")).toLowerCase()] };
}
const attachments = [];
for (const plan of attachmentsPlan) {
  const request = caseRequest(plan.demoCase);
  if (!request) continue;
  const visit = plan.parent === "visit" ? firstVisit(request) : null;
  const reply = plan.parent === "reply" ? payload.messages.find((m) => m.request_id === request.id && m.direction === "incoming") : null;
  const invoice = plan.parent === "invoice" ? payload.invoices.find((i) => i.request_id === request.id) : null;
  const file = demoFile(plan.file);
  const bytes = await readFile(new URL(file.name, filesDir));
  const storagePath = `${FILE_PREFIX}/${request.id}/${file.name}`;
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, bytes, { contentType: file.mime, upsert: true });
  if (uploadError) throw new Error(`Upload ${file.name}: ${uploadError.message}`);
  attachments.push({
    request_id: request.id,
    visit_id: visit?.id ?? null,
    message_id: reply?.id ?? null,
    invoice_id: invoice?.id ?? null,
    bucket: BUCKET,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.mime,
    size_bytes: bytes.length,
    uploaded_by: visit?.technician_id ?? null,
    visibility: plan.visibility,
  });
}
const { error: attachmentError } = await admin.from("attachments").insert(attachments);
if (attachmentError) throw new Error(`Anhänge: ${attachmentError.message}`);
console.log(`Demo-Dateien: ${attachments.length} im privaten Bucket ${BUCKET}/${FILE_PREFIX}/`);

// Accounts of earlier test runs: their test requests were removed with the demo data above
console.log("Testkonten (api-/ui-/e2e-…@example.com):", await cleanupTestAccounts(admin));
