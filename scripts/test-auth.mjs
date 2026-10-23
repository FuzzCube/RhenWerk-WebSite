// End-to-end checks of login, role start pages, navigation, access and logout over HTTP (task-4-1).
// Uses the real login form without JavaScript (progressive enhancement of the server action).
// Usage: npm run build && npm run start, then npm run test:auth   (APP_URL default http://localhost:3000)
// Requires the local Supabase stack and the demo users (npm run demo:users).
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const pw = process.env.DEMO_USER_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!pw || !supabaseUrl || !process.env.SUPABASE_SECRET_KEY) {
  console.error("DEMO_USER_PASSWORD, NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SECRET_KEY werden benötigt.");
  process.exit(1);
}
const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/;
if (!local.test(BASE) || !local.test(supabaseUrl)) {
  console.error("Abbruch: test:auth läuft nur gegen lokale App und lokalen Supabase-Stack.");
  process.exit(1);
}
try {
  await fetch(`${BASE}/login`, { redirect: "manual" });
} catch {
  console.error(`App unter ${BASE} nicht erreichbar. Zuerst npm run build && npm run start ausführen.`);
  process.exit(1);
}
console.log(`Anmelde-Prüfung gegen ${BASE}\n`);
let fail = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${ok ? "" : " – " + d}`); if (!ok) fail++; };
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// Minimal cookie jar
class Jar { c = new Map(); add(res) { for (const h of res.headers.getSetCookie()) { const [kv] = h.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/max-age=0|expires=thu, 01 jan 1970/i.test(h) || v === "") this.c.delete(k); else this.c.set(k, v); } } get header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); } }
async function get(jar, path) { const r = await fetch(BASE + path, { headers: { cookie: jar.header }, redirect: "manual" }); jar.add(r); return { status: r.status, loc: r.headers.get("location"), cc: r.headers.get("cache-control"), html: await r.text() }; }
function hidden(html, formIndex = 0) { const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? []; const f = forms[formIndex] ?? ""; const fd = new FormData(); for (const m of f.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) fd.append(decode(m[1]), decode(m[2] ?? "")); return fd; }
async function post(jar, path, fd) { const r = await fetch(BASE + path, { method: "POST", body: fd, headers: { cookie: jar.header }, redirect: "manual" }); jar.add(r); return { status: r.status, loc: r.headers.get("location"), html: await r.text() }; }
async function login(email, password) { const jar = new Jar(); const page = await get(jar, "/login"); const fd = hidden(page.html); fd.append("email", email); fd.append("password", password); const res = await post(jar, "/login", fd); return { jar, res }; }
const path = (loc) => (loc ? new URL(loc, BASE).pathname : null);

const roles = [
  ["admin.demo@example.com", "Clara Becker", "/dashboard/uebersicht", ["Übersicht", "Auswertung", "Einsatzplanung", "Anfragen", "Posteingang", "Rechnungen", "Verwaltung", "System"], "/dashboard/heute"],
  ["manager.demo@example.com", "Jonas Hoffmann", "/dashboard/uebersicht", ["Übersicht", "Auswertung", "Einsatzplanung", "Anfragen", "Posteingang", "Rechnungen", "System"], "/dashboard/verwaltung"],
  ["dispo1.demo@example.com", "Lea Schneider", "/dashboard/erstbearbeitung", ["Erstbearbeitung", "Einsatzplanung", "Anfragen", "Posteingang"], "/dashboard/uebersicht"],
  ["technik1.demo@example.com", "Tobias Krüger", "/dashboard/heute", ["Mein Tag", "Kalender", "Anfragen"], "/dashboard/planung"],
];
const ALL = ["Übersicht", "Auswertung", "Erstbearbeitung", "Mein Tag", "Kalender", "Einsatzplanung", "Anfragen", "Posteingang", "Rechnungen", "Verwaltung", "System"];
for (const [email, name, start, nav, forbidden] of roles) {
  const { jar, res } = await login(email, pw);
  check(`${email}: Login leitet zu /dashboard`, res.status === 303 && path(res.loc) === "/dashboard", `${res.status} ${res.loc}`);
  const d = await get(jar, "/dashboard");
  check(`  /dashboard → ${start}`, d.status === 307 && path(d.loc) === start, `${d.status} ${d.loc}`);
  const s = await get(jar, start);
  const navHtml = (s.html.match(/<nav class="dash-nav"[\s\S]*?<\/nav>/) ?? [""])[0];
  const shown = ALL.filter((l) => navHtml.includes(`>${l}<`));
  check(`  Startseite 200, Name sichtbar`, s.status === 200 && s.html.includes(name), String(s.status));
  check(`  Navigation: ${nav.join(", ")}`, JSON.stringify(shown.sort()) === JSON.stringify([...nav].sort()), shown.join(","));
  check(`  Cache-Control privat/no-store`, /private/.test(s.cc) && /no-store/.test(s.cc), s.cc);
  check(`  keine Website-Kopfzeile im Dashboard`, !s.html.includes("site-header"));
  const f = await get(jar, forbidden);
  check(`  fremder Bereich ${forbidden} → eigene Startseite`, f.status === 307 && path(f.loc) === start, `${f.status} ${f.loc}`);
  const l = await get(jar, "/login");
  check(`  /login angemeldet → /dashboard`, l.status === 307 && path(l.loc) === "/dashboard", `${l.status}`);
  const u = await get(jar, "/dashboard/gibtsnicht");
  check(`  unbekannter Pfad → 404 im Dashboard`, u.status === 404 || u.html.includes("Diese Seite gibt es im Dashboard nicht"), String(u.status));
  // Logout over the header form (first form = logout)
  const out = await post(jar, start, hidden(s.html, 0));
  check(`  Abmelden → /login`, out.status === 303 && path(out.loc) === "/login", `${out.status} ${out.loc}`);
  const after = await get(jar, start);
  check(`  nach Abmelden kein Zugriff`, after.status === 307 && path(after.loc) === "/login", `${after.status} ${after.loc}`);
}

// Manager overview and invoices (task-7-2): managers only, no data for other roles
{
  const manager = (await login("manager.demo@example.com", pw)).jar;
  for (const target of ["/dashboard/uebersicht?zeitraum=quartal", "/dashboard/rechnungen?status=offen", "/dashboard/auswertung?zeitraum=jahr"]) {
    const page = await get(manager, target);
    check(`Manager: ${target} 200`, page.status === 200 && !page.html.includes("Daten konnten nicht geladen werden"), String(page.status));
  }
  for (const [email, start] of [["dispo1.demo@example.com", "/dashboard/erstbearbeitung"], ["technik1.demo@example.com", "/dashboard/heute"]]) {
    const jar = (await login(email, pw)).jar;
    for (const target of ["/dashboard/uebersicht", "/dashboard/rechnungen", "/dashboard/auswertung"]) {
      const page = await get(jar, target);
      check(`${email.split(".")[0]}: ${target} → eigene Startseite`, page.status === 307 && path(page.loc) === start, `${page.status} ${page.loc}`);
    }
  }
}

// Wrong password and unknown address: same message, no session. Earlier runs may have left failures for these
// addresses (task-11-6), so the counters start empty.
const throttleAdmin = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const loginKey = async (email) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()))).toString("hex");
for (const email of ["dispo1.demo@example.com", "niemand@example.com"]) await throttleAdmin.rpc("login_reset", { email_hash: await loginKey(email) });
for (const [email, password] of [["dispo1.demo@example.com", "falsch-123"], ["niemand@example.com", "falsch-123"]]) {
  const { jar, res } = await login(email, password);
  check(`Fehlanmeldung ${email}: Fehlermeldung, keine Weiterleitung`, res.status === 200 && res.html.includes("Anmeldung fehlgeschlagen"), String(res.status));
  const d = await get(jar, "/dashboard");
  check(`  danach kein Zugriff`, d.status === 307 && path(d.loc) === "/login");
}

// Growing pause after wrong passwords (task-11-6): own temporary account, plus an unknown address
{
  const email = `e2e-pause-${Date.now().toString(36)}@example.com`;
  const { data } = await throttleAdmin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  await throttleAdmin.from("profiles").insert({ id: data.user.id, display_name: "E2E Pause", role: "dispatcher" });
  const messages = [];
  // Alternating upper and lower case: the attempts count for the same address
  for (let attempt = 1; attempt <= 5; attempt += 1) messages.push((await login(attempt % 2 ? email : email.toUpperCase(), `falsch-${attempt}-123`)).res.html);
  check("Pause: vier Fehlversuche mit normaler Meldung (Groß-/Kleinschreibung egal)", messages.slice(0, 4).every((html) => html.includes("Anmeldung fehlgeschlagen") && !html.includes("Zu viele Fehlversuche")));
  check("  fünfter Fehlversuch startet 30 Sekunden Pause", messages[4].includes("Zu viele Fehlversuche. Bitte in 30 Sekunden erneut versuchen."));
  const blocked = await login(email, pw);
  check("  während der Pause auch richtiges Passwort abgewiesen, keine Sitzung", blocked.res.status === 200 && blocked.res.html.includes("Zu viele Fehlversuche") && (await get(blocked.jar, "/dashboard")).status === 307);
  const unknown = `e2e-niemand-${Date.now().toString(36)}@example.com`;
  const unknownMessages = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) unknownMessages.push((await login(unknown, `falsch-${attempt}-123`)).res.html);
  check("  unbekannte Adresse verhält sich gleich (keine Kontoauskunft)", unknownMessages[3].includes("Anmeldung fehlgeschlagen") && unknownMessages[4].includes("in 30 Sekunden erneut versuchen"));
  // A new password from the admin ends the pause (same reset as the app's admin action)
  await throttleAdmin.rpc("login_reset", { email_hash: await loginKey(email) });
  const after = await login(email, pw);
  check("  nach dem Zurücksetzen Anmeldung möglich, Zähler leer", after.res.status === 303 && path(after.res.loc) === "/dashboard");
  const { data: rest } = await throttleAdmin.rpc("login_pause_remaining", { email_hash: await loginKey(email) });
  check("  erfolgreiche Anmeldung hinterlässt keine Pause", rest === 0, String(rest));
  await throttleAdmin.rpc("login_reset", { email_hash: await loginKey(unknown) });
  await throttleAdmin.from("profiles").delete().eq("id", data.user.id);
  await throttleAdmin.auth.admin.deleteUser(data.user.id);
}

// Deactivated profile and user without profile
const admin = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const run = Date.now().toString(36);
const tmp = [];
for (const kind of ["inaktiv", "ohneprofil", "spaeter-deaktiviert"]) {
  const email = `e2e-${kind}-${run}@example.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  tmp.push(data.user.id);
  if (kind !== "ohneprofil") {
    await admin.from("profiles").insert({ id: data.user.id, display_name: `E2E ${kind}`, role: "dispatcher", is_active: kind !== "inaktiv" });
  }
  const { jar } = await login(email, pw);
  if (kind === "spaeter-deaktiviert") {
    const before = await get(jar, "/dashboard/anfragen");
    check(`${kind}: aktiv angemeldet`, before.status === 200, String(before.status));
    // Deactivation takes effect on the next request of the existing session
    await admin.from("profiles").update({ is_active: false }).eq("id", data.user.id);
  }
  const d = await get(jar, "/dashboard/anfragen");
  check(`${kind}: /dashboard/anfragen → /login`, d.status === 307 && path(d.loc) === "/login", `${d.status} ${d.loc}`);
  const l = await get(jar, "/login");
  check(`  Login-Seite zeigt Hinweis + Abmelden`, l.status === 200 && l.html.includes("kein aktives Mitarbeiterprofil") && l.html.includes("Abmelden"), String(l.status));
}
await admin.from("profiles").delete().in("id", tmp);
for (const id of tmp) await admin.auth.admin.deleteUser(id);

// Request list and request page (task-4-3): RLS decides rows, sections follow the role
console.log("\nAnfragen");
const { data: userList } = await admin.auth.admin.listUsers({ perPage: 1000 });
const userId = (email) => userList.users.find((user) => user.email === email)?.id;
const countOf = async (build) => { const { count } = await build(admin.from("requests").select("id", { count: "exact", head: true })); return count; };
// Count line of the list card (task-10-3: "<strong>684 Anfragen</strong> · Alle"); tags are stripped before matching
const shownTotal = (html) => { const line = /<p class="result-count"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? ""; return Number((/([\d.]+) Anfrage/.exec(line.replace(/<[^>]+>/g, ""))?.[1] ?? "-1").replaceAll(".", "")); };
// Content sections only; the "Aktionen" block depends on the request state (task-5-2) and the technician's own
// visit card (id "visit", task-10-3) replaces the "Einsätze" section in the technician view
const sectionTitles = (html) => [...html.matchAll(/<h2 id="([a-z]+)-title">([^<]+)<\/h2>/g)].filter((match) => match[1] !== "visit").map((match) => match[2]).filter((title) => title !== "Aktionen");
const ALL_SECTIONS = ["Anliegen", "Kontakt", "Anlage", "Erstbearbeitung", "Korrespondenz", "Einsätze", "Arbeit", "Dokumente", "Rechnung", "Verlauf"];

const managerJar = (await login("manager.demo@example.com", pw)).jar;
const dispoJar = (await login("dispo1.demo@example.com", pw)).jar;
const techJar = (await login("technik1.demo@example.com", pw)).jar;
const dispo1 = userId("dispo1.demo@example.com");
const tech1 = userId("technik1.demo@example.com");

const allCount = await countOf((query) => query);
const managerList = await get(managerJar, "/dashboard/anfragen?ansicht=alle");
check(`Manager sieht alle Anfragen (${allCount})`, shownTotal(managerList.html) === allCount, String(shownTotal(managerList.html)));
const dispoCount = await countOf((query) => query.eq("dispatcher_id", dispo1));
check(`Dispatcher sieht nur eigene (${dispoCount})`, shownTotal((await get(dispoJar, "/dashboard/anfragen?ansicht=alle")).html) === dispoCount);
const { data: ownVisits } = await admin.from("visits").select("request_id").eq("technician_id", tech1);
const techIds = new Set(ownVisits.map((visit) => visit.request_id));
// Paged: the API returns at most max_rows (1000) rows per request
const allRequests = [];
for (let from = 0; ; from += 1000) {
  const { data } = await admin.from("requests").select("id, technician_id").order("id").range(from, from + 999);
  allRequests.push(...data);
  if (data.length < 1000) break;
}
const techVisible = (request) => request.technician_id === tech1 || techIds.has(request.id);
const techCount = allRequests.filter(techVisible).length;
check(`Techniker sieht zugewiesene und eigene Einsätze (${techCount})`, shownTotal((await get(techJar, "/dashboard/anfragen?ansicht=alle")).html) === techCount);
// Without parameters the list opens with the open requests (task-10-3)
const openCount = await countOf((query) => query.not("intake_status", "in", "(rejected,cancelled)").not("work_status", "in", "(completed,cancelled)"));
check(`Ohne Filter: Ansicht „Offen“ (${openCount})`, shownTotal((await get(managerJar, "/dashboard/anfragen")).html) === openCount);
const reviewCount = await countOf((query) => query.eq("intake_status", "needs_review"));
check(`Filter Erstbearbeitung = Prüfung erforderlich (${reviewCount})`, shownTotal((await get(managerJar, "/dashboard/anfragen?erstbearbeitung=needs_review")).html) === reviewCount);
const { data: sample } = await admin.from("requests").select("id, request_number, dispatcher_id").eq("dispatcher_id", dispo1).limit(1).single();
check("Suche nach Anfragenummer", shownTotal((await get(managerJar, `/dashboard/anfragen?suche=${sample.request_number}`)).html) === 1);
check("Unbekannter Filterwert wird ignoriert", shownTotal((await get(managerJar, "/dashboard/anfragen?arbeit=%27%3Bdrop")).html) === allCount);
const lastPage = Math.ceil(allCount / 25);
const pageLast = await get(managerJar, `/dashboard/anfragen?ansicht=alle&seite=${lastPage}`);
check("Letzte Seite erreichbar", pageLast.status === 200 && pageLast.html.replace(/<[^>]+>/g, "").includes(`Seite ${lastPage} von ${lastPage}`));

const managerDetail = await get(managerJar, `/dashboard/anfragen/${sample.id}`);
// Two-column layout (task-10-3): sections are compared as a set, their order follows the layout
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
check("Manager: alle 10 Abschnitte", sameSet(sectionTitles(managerDetail.html), ALL_SECTIONS), sectionTitles(managerDetail.html).join(","));
check("  Anfrageseite privat, no-store", /no-store/.test(managerDetail.cc ?? ""), managerDetail.cc);
const dispoDetail = await get(dispoJar, `/dashboard/anfragen/${sample.id}`);
check("Dispatcher: eigene Anfrage mit allen 10 Abschnitten", dispoDetail.status === 200 && sectionTitles(dispoDetail.html).length === 10);
const { data: foreign } = await admin.from("requests").select("id").neq("dispatcher_id", dispo1).not("dispatcher_id", "is", null).limit(1).single();
check("Dispatcher: fremde Anfrage → 404", (await get(dispoJar, `/dashboard/anfragen/${foreign.id}`)).status === 404);
check("Ungültige ID → 404", (await get(managerJar, "/dashboard/anfragen/keine-uuid")).status === 404);

const { data: techRequest } = await admin.from("requests").select("id, description").eq("technician_id", tech1).limit(1).single();
const techDetail = await get(techJar, `/dashboard/anfragen/${techRequest.id}`);
const techSections = sectionTitles(techDetail.html);
check("Techniker: eigener Einsatz oben, 7 Abschnitte ohne Erstbearbeitung und Korrespondenz", techDetail.html.includes('id="visit-title"') && sameSet(techSections, ALL_SECTIONS.filter((title) => !["Erstbearbeitung", "Korrespondenz", "Einsätze"].includes(title))), techSections.join(","));
const { data: techMessages } = await admin.from("messages").select("subject").eq("request_id", techRequest.id);
// The technician's action slot only shows the state or the inactive invoice step (task-10-3), never review actions
check("  keine Prüfaktionen für Techniker", !techDetail.html.includes("Prüfen und freigeben") && !techDetail.html.includes("Als Entwurf speichern"));
const { data: reviewRequest } = await admin.from("requests").select("id").eq("intake_status", "needs_review").eq("is_demo", true).limit(1).single();
const managerReview = await get(managerJar, `/dashboard/anfragen/${reviewRequest.id}`);
check("Manager: Prüfaktionen bei offener Prüfung", managerReview.html.includes('id="aktionen"') && managerReview.html.includes("Prüfen und freigeben"));
check("  kein Versandknopf, nur Entwurf", !/>\s*(Senden|E-Mail senden|Jetzt senden)\s*</.test(managerReview.html) && managerReview.html.includes("Als Entwurf speichern"));
{
  // A request created from an e-mail (task-10-5) may carry the subject in its description, which the technician sees
  const leaked = techMessages.find((message) => techDetail.html.includes(message.subject) && !techRequest.description.includes(message.subject));
  const at = leaked ? techDetail.html.indexOf(leaked.subject) : -1;
  check("  keine Nachrichteninhalte im HTML", !leaked, leaked ? techDetail.html.slice(Math.max(0, at - 160), at + 80) : "");
}
const notTech = allRequests.find((request) => !techVisible(request));
check("Techniker: fremde Anfrage → 404", (await get(techJar, `/dashboard/anfragen/${notTech.id}`)).status === 404);

// Documents: management note only for manager/admin, operational files for the technician of the request
const { data: files } = await admin.from("attachments").select("id, request_id, file_name, visibility").like("storage_path", "demo/%");
const note = files.find((file) => file.visibility === "management");
const noteRequest = (await admin.from("requests").select("dispatcher_id").eq("id", note.request_id).single()).data;
const noteDispatcher = userList.users.find((user) => user.id === noteRequest.dispatcher_id);
const noteUrl = `/dashboard/anfragen/${note.request_id}/dokumente/${note.id}`;
const managerFile = await fetch(BASE + noteUrl, { headers: { cookie: managerJar.header } });
check("Manager lädt interne Notiz (PDF)", managerFile.status === 200 && managerFile.headers.get("content-type") === "application/pdf" && /no-store/.test(managerFile.headers.get("cache-control") ?? ""), String(managerFile.status));
const noteDispoJar = (await login(noteDispatcher.email, pw)).jar;
const noteDispoPage = await get(noteDispoJar, `/dashboard/anfragen/${note.request_id}`);
check("Dispatcher der Anfrage sieht interne Notiz nicht in der Liste", noteDispoPage.status === 200 && !noteDispoPage.html.includes(note.file_name));
check("  und kann sie nicht laden", (await fetch(BASE + noteUrl, { headers: { cookie: noteDispoJar.header } })).status === 404);
check("Anonym kein Download", (await fetch(BASE + noteUrl, { redirect: "manual" })).status === 401);
const operational = files.find((file) => file.visibility === "operational");
const opTech = (await admin.from("requests").select("technician_id").eq("id", operational.request_id).single()).data.technician_id;
const opTechJar = (await login(userList.users.find((user) => user.id === opTech).email, pw)).jar;
const opResponse = await fetch(`${BASE}/dashboard/anfragen/${operational.request_id}/dokumente/${operational.id}`, { headers: { cookie: opTechJar.header } });
check("Techniker lädt operatives Dokument seiner Anfrage", opResponse.status === 200 && Number(opResponse.headers.get("content-length")) > 0, String(opResponse.status));
// "Other" technician: neither assigned nor planned on any visit of the request (visits grant read access)
const { data: opVisits } = await admin.from("visits").select("technician_id").eq("request_id", operational.request_id);
const linked = new Set([opTech, ...opVisits.map((visit) => visit.technician_id)]);
const otherTech = ["technik1.demo@example.com", "technik2.demo@example.com", "technik3.demo@example.com"].map((email) => userList.users.find((user) => user.email === email)).find((user) => user && !linked.has(user.id));
const opOther = await fetch(`${BASE}/dashboard/anfragen/${operational.request_id}/dokumente/${operational.id}`, { headers: { cookie: (await login(otherTech.email, pw)).jar.header } });
check("Anderer Techniker lädt es nicht", opOther.status === 404, String(opOther.status));

// Dispatcher queues (task-5-1): counts and order equal the view, other roles have no access
console.log("\nWarteschlangen Dispatcher");
const QUEUES = [["pruefung", "review"], ["antwort", "reply_received"], ["planung", "planning"], ["warten", "awaiting_customer"]];
for (const email of ["dispo1.demo@example.com", "dispo2.demo@example.com", "dispo3.demo@example.com"]) {
  const jar = (await login(email, pw)).jar;
  const id = userId(email);
  for (const [slug, queue] of QUEUES) {
    const { data: expected } = await admin.from("dispatcher_queue").select("request_number").eq("dispatcher_id", id).eq("queue", queue)
      .order("priority_rank").order("due_at", { ascending: true, nullsFirst: false }).order("waiting_since").order("id");
    const page = await get(jar, `/dashboard/erstbearbeitung?tab=${slug}`);
    const shown = [...page.html.matchAll(/<span class="mono">(RIS-\d{4}-\d{5})<\/span>/g)].map((match) => match[1]);
    check(`${email.split(".")[0]} ${slug}: ${expected.length} Anfragen in Reihenfolge der Datenbank`, page.status === 200 && JSON.stringify(shown) === JSON.stringify(expected.map((row) => row.request_number)), `${shown.join(",")} ≠ ${expected.map((row) => row.request_number).join(",")}`);
  }
}
const managerQueue = await get(managerJar, "/dashboard/erstbearbeitung");
check("Manager hat keinen Zugriff auf Dispatcher-Warteschlangen", managerQueue.status === 307 && path(managerQueue.loc) === "/dashboard/uebersicht", String(managerQueue.status));
const { data: autoPlanning } = await admin.from("dispatcher_queue").select("dispatcher_id").eq("queue", "planning").eq("intake_mode", "automatic");
check("Automatisch bearbeitete, ungeplante Anfragen stehen in der Planung", autoPlanning.length > 0, "keine im Demo-Datensatz");

// Visit planning (task-5-3): queue per role, foreign intervals without details
console.log("\nEinsatzplanung");
const planningOf = async (dispatcher) => {
  let query = admin.from("dispatcher_queue").select("request_number").eq("queue", "planning");
  if (dispatcher) query = query.eq("dispatcher_id", dispatcher);
  return (await query).data.map((row) => row.request_number).sort();
};
const queueNumbers = (html) => [...html.matchAll(/class="plan3__item"[^>]*><span class="plan3__item-head"><span class="mono">(RIS-\d{4}-\d{5})<\/span>/g)].map((match) => match[1]).sort();
const dispoPlan = await get(dispoJar, "/dashboard/planung");
check("Dispatcher: Liste „Zu planen“ = eigene Planungs-Warteschlange", JSON.stringify(queueNumbers(dispoPlan.html)) === JSON.stringify(await planningOf(dispo1)), queueNumbers(dispoPlan.html).join(","));
const managerPlan = await get(managerJar, "/dashboard/planung");
check("Manager: Liste „Zu planen“ = alle", JSON.stringify(queueNumbers(managerPlan.html)) === JSON.stringify(await planningOf(null)));
const techPlan = await get(techJar, "/dashboard/planung");
check("Techniker: kein Zugriff auf die Planung", techPlan.status === 307);

// Current week in Berlin: Monday 00:00 … next Monday 00:00
const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
const weekday = (new Date(`${berlinDay}T00:00:00Z`).getUTCDay() + 6) % 7;
const monday = new Date(Date.parse(`${berlinDay}T00:00:00Z`) - weekday * 86400000);
const from = new Date(monday.getTime() - 2 * 3600000).toISOString();
const to = new Date(monday.getTime() + 7 * 86400000 + 2 * 3600000).toISOString();
const { data: weekVisits } = await admin.from("visits").select("request_id, requests!inner(request_number, company_name, dispatcher_id)").in("status", ["scheduled", "in_progress"]).lt("scheduled_start", to).gt("scheduled_end", from);
const foreignWeekVisits = weekVisits.filter((visit) => visit.requests.dispatcher_id !== dispo1);
const dispoWeekVisits = weekVisits.filter((visit) => visit.requests.dispatcher_id === dispo1);
// Plantafel from Monday (task-10-3, since task-20-14 the working week Monday to Friday of ?woche=); blocks carry their label in the title
const weekPlan = await get(dispoJar, `/dashboard/planung?woche=${monday.toISOString().slice(0, 10)}`);
const calendarHtml = weekPlan.html.slice(weekPlan.html.indexOf('class="plan3__board'));
check(`Kalender zeigt belegte Zeiten fremder Anfragen (${foreignWeekVisits.length}) als „Belegt“`, foreignWeekVisits.length === 0 || calendarHtml.includes('title="Belegt · '));
check("  ohne Nummer oder Firma fremder Anfragen", foreignWeekVisits.every((visit) => !calendarHtml.includes(visit.requests.request_number) && !weekPlan.html.includes(visit.requests.company_name)), foreignWeekVisits.map((visit) => visit.requests.request_number).join(","));
check(`  eigene Einsätze (${dispoWeekVisits.length}) mit Anfragenummer`, dispoWeekVisits.every((visit) => calendarHtml.includes(visit.requests.request_number)));
const { data: absences } = await admin.from("employee_availability").select("label").eq("kind", "absence").not("label", "is", null);
check(`  Abwesenheiten ohne Grund (${absences.length} Bezeichnungen geprüft)`, absences.every((absence) => ![dispoPlan.html, weekPlan.html].some((html) => html.includes(`>${absence.label}<`) || html.includes(`${absence.label}:`) || html.includes(`${absence.label} · `))));

// Technician pages (task-6-1): own data only
console.log("\nTechniker-Startseite und Kalender");
const technicianNames = (await admin.from("profiles").select("id, display_name").eq("role", "technician")).data;
for (const email of ["technik1.demo@example.com", "technik2.demo@example.com", "technik3.demo@example.com"]) {
  const jar = (await login(email, pw)).jar;
  const me = userId(email);
  const short = email.split(".")[0];
  const nowIso = new Date().toISOString();
  const running = (await admin.from("visits").select("requests!inner(request_number)").eq("technician_id", me).eq("status", "in_progress").order("scheduled_start").limit(1)).data;
  const upcoming = (await admin.from("visits").select("requests!inner(request_number)").eq("technician_id", me).eq("status", "scheduled").gt("scheduled_end", nowIso).order("scheduled_start").limit(1)).data;
  const expectedNext = (running[0] ?? upcoming[0])?.requests.request_number ?? null;
  const today = await get(jar, "/dashboard/heute");
  // "Jetzt"/"Als Nächstes" card only when there is a running or next visit (task-10-3)
  const nowStart = today.html.indexOf('id="now-title"');
  const nextSection = nowStart < 0 ? "" : today.html.slice(nowStart, today.html.indexOf('id="today-title"'));
  check(`${short}: nächster Einsatz = ${expectedNext ?? "keiner"}`, today.status === 200 && (expectedNext ? nextSection.includes(expectedNext) : nowStart < 0));
  const { data: ordered } = await admin.from("work_entries").select("description, requests!inner(request_number, technician_id)").eq("kind", "part").eq("item_status", "ordered").eq("requests.technician_id", me);
  check(`${short}: ausstehende Teile (${ordered.length}) aufgeführt`, ordered.every((entry) => today.html.includes(entry.requests.request_number) && today.html.includes(entry.description)));

  const calendar = await get(jar, "/dashboard/kalender");
  // Own week agenda (task-10-3): day columns, no names of other technicians
  const days = (calendar.html.match(/class="cal-day[ "]/g) ?? []).length;
  const others = technicianNames.filter((tech) => tech.id !== me);
  check(`${short}: Kalender nur mit eigenen Tagen, keine anderen Techniker`, calendar.status === 200 && days > 0 && others.every((tech) => !calendar.html.includes(tech.display_name)), String(days));
  // Visits of other technicians in this week, also on requests the technician can read
  const { data: foreign } = await admin.from("visits").select("id, request_id, requests!inner(request_number)").neq("technician_id", me).in("status", ["scheduled", "in_progress"]).lt("scheduled_start", to).gt("scheduled_end", from);
  const { data: own } = await admin.from("visits").select("request_id").eq("technician_id", me);
  const ownRequests = new Set(own.map((visit) => visit.request_id));
  const leaked = foreign.filter((visit) => !ownRequests.has(visit.request_id) && calendar.html.includes(visit.requests.request_number));
  check(`${short}: keine Einsätze anderer Techniker im Kalender`, leaked.length === 0, leaked.map((visit) => visit.requests.request_number).join(","));
}
const dispoCalendar = await get(dispoJar, "/dashboard/kalender");
check("Dispatcher hat keinen Techniker-Kalender", dispoCalendar.status === 307);

// Administration (task-8-1): no public registration, admin-only pages
const publicClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const signup = await publicClient.auth.signUp({ email: `e2e-signup-${run}@example.com`, password: `${pw}x` });
check("Öffentliche Registrierung abgewiesen", Boolean(signup.error) && !signup.data.user, signup.error?.code ?? "angelegt");
const adminJar = (await login("admin.demo@example.com", pw)).jar;
const adminId = userId("admin.demo@example.com");
for (const page of ["/dashboard/verwaltung/arbeitszeiten", "/dashboard/verwaltung/tarife", "/dashboard/verwaltung/einstellungen", `/dashboard/verwaltung/mitarbeitende/${adminId}`]) {
  const own = await get(adminJar, page);
  const other = await get(managerJar, page);
  check(`${page}: Admin 200, Manager → eigene Startseite`, own.status === 200 && other.status === 307 && path(other.loc) === "/dashboard/uebersicht", `${own.status} ${other.status} ${other.loc}`);
}
const ownPage = await get(adminJar, `/dashboard/verwaltung/mitarbeitende/${adminId}`);
check("  eigenes Konto: keine Deaktivierung angeboten", !ownPage.html.includes('id="deaktivieren-title"'));
const unknown = await get(adminJar, "/dashboard/verwaltung/mitarbeitende/00000000-0000-0000-0000-000000000000");
check("  unbekannte Person → 404", unknown.status === 404, String(unknown.status));

// Area "System" (task-17-7, task-17-12): admin and manager read the same summary, no code update buttons; other roles
// go to their start page
{
  const { jar: adminJar } = await login("admin.demo@example.com", pw);
  const a = await get(adminJar, "/dashboard/system");
  const owner = (html) => html.includes("Datensicherung") && html.includes("Zustand der Systeme") && /Alles in Ordnung|brauch(t|en) Aufmerksamkeit/.test(html);
  const noCode = (html) => !/>(Jetzt aktualisieren|Wiederherstellen)<\/button>/.test(html) && !html.includes("Verlauf der Updates");
  check("/dashboard/system: Admin 200 mit Zusammenfassung und Datensicherung, ohne Code-Updates", a.status === 200 && owner(a.html) && noCode(a.html), String(a.status));
  check("  privat/no-store", /no-store/.test(a.cc ?? ""), a.cc);
  const { jar: managerJar } = await login("manager.demo@example.com", pw);
  const m = await get(managerJar, "/dashboard/system");
  check("  Manager 200, gleiche Inhalte", m.status === 200 && owner(m.html) && noCode(m.html), String(m.status));
  for (const [email, start] of [["dispo1.demo@example.com", "/dashboard/erstbearbeitung"], ["technik1.demo@example.com", "/dashboard/heute"]]) {
    const { jar } = await login(email, pw);
    const r = await get(jar, "/dashboard/system");
    check(`  ${email.split(".")[0]} → ${start}`, r.status === 307 && path(r.loc) === start, `${r.status} ${r.loc}`);
  }
}

// Health check (task-17-4): public only the status, details only with HEALTH_TOKEN, never cached
{
  const health = async (authorization) => {
    const r = await fetch(`${BASE}/api/health`, { headers: authorization ? { Authorization: authorization } : {} });
    return { status: r.status, cc: r.headers.get("cache-control"), body: await r.json() };
  };
  const open = await health();
  check("/api/health ohne Token: 200, nur Status", open.status === 200 && JSON.stringify(open.body) === '{"status":"ok"}', `${open.status} ${JSON.stringify(open.body)}`);
  check("  Cache-Control no-store", /no-store/.test(open.cc ?? ""), open.cc);
  const wrong = await health("Bearer falsch");
  check("  falscher Token: nur Status", JSON.stringify(wrong.body) === '{"status":"ok"}', JSON.stringify(wrong.body));
  if (process.env.HEALTH_TOKEN) {
    const full = await health(`Bearer ${process.env.HEALTH_TOKEN}`);
    check("  mit Token: Commit, Datenbank und n8n mit Laufzeit",
      typeof full.body.commit === "string" && full.body.db?.ok === true && typeof full.body.db?.ms === "number" && typeof full.body.n8n?.ok === "boolean",
      JSON.stringify(full.body));
  } else {
    check("  mit Token: HEALTH_TOKEN fehlt in .env.local", false, "nicht geprüft");
  }
}

console.log(fail ? `${fail} fehlgeschlagen` : "Alle Prüfungen bestanden");
process.exit(fail ? 1 : 0);
