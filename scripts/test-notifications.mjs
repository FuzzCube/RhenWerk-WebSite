// Local integration test: shared dashboard poller, two employees, RLS, same-count replies, offline and dirty forms.
// APP_URL=http://localhost:3117 node --env-file=.env.local scripts/test-notifications.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_URL ?? "http://localhost:3117";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const password = process.env.DEMO_USER_PASSWORD;
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
if (!password || !local.test(BASE) || !local.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Nur lokale App und lokaler Supabase mit DEMO_USER_PASSWORD erlaubt");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `: ${detail}`}`); if (!ok) failures++; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (text) => text.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const must = ({data, error}) => { if (error) throw new Error(error.message); return data; };
// Login over the real form (no JavaScript); returns the session cookies
async function loginCookies(email) {
  const jar = new Map();
  const keep = (response) => {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const index = pair.indexOf("=");
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  };
  const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  const page = await fetch(`${BASE}/login`, { redirect: "manual" });
  keep(page);
  const html = await page.text();
  const form = new FormData();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) form.append(decode(match[1]), decode(match[2] ?? ""));
  form.append("email", email);
  form.append("password", password);
  const response = await fetch(`${BASE}/login`, { method: "POST", body: form, headers: { cookie: cookie() }, redirect: "manual" });
  keep(response);
  if (response.status !== 303) throw new Error(`Login ${email} fehlgeschlagen (${response.status})`);
  return [...jar].filter(([, value]) => value !== "").map(([name, value]) => ({ name, value, url: BASE }));
}

// Minimal DevTools protocol client for one page
class Page {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  waitFor(method, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(listener); reject(new Error(`Timeout ${method}`)); }, timeout);
      const listener = (message) => {
        if (message.method !== method) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(message.params);
      };
      this.listeners.add(listener);
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Auswertung fehlgeschlagen");
    return result.result.value;
  }
  async until(expression, timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.eval(expression)) return true;
      await sleep(100);
    }
    return false;
  }
  async open(url) {
    const loaded = this.waitFor("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
    // Hydration and fonts
    await this.until("document.readyState === 'complete'");
    await sleep(300);
  }
}

const profile = await mkdtemp(path.join(tmpdir(), "rw-notifications-"));
const port = 9800 + Math.floor(Math.random() * 200);
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const run = Date.now().toString(36);
const users = [], requests = [], messages = [], warnings = [], visits = [], changes = [], calls = [];
let page;
let faultServer;
const faultPort = 10800 + Math.floor(Math.random() * 500);
const faultUrl = `http://localhost:${faultPort}`;
const faultFile = path.join(profile, "fail-profile-fetch.mjs");
async function stopFaultServer() {
  const child = faultServer;
  faultServer = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    timer.unref();
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}
async function startFaultServer(failProfiles) {
  await stopFaultServer();
  // Separate Next process only: no Supabase stop, schema/config change or production test hook.
  faultServer = spawn(process.execPath, [
    ...(failProfiles ? ["--import", faultFile] : []),
    path.resolve("node_modules/next/dist/bin/next"), "start", "--port", String(faultPort),
  ], { stdio: "ignore", env: process.env });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (faultServer.exitCode !== null) throw new Error("Separater Prüfserver konnte nicht starten");
    try { if ((await fetch(`${faultUrl}/login`)).ok) return; } catch { /* starting */ }
    await sleep(200);
  }
  throw new Error("Separater Prüfserver nicht erreichbar");
}
const networkRequests = [];
const shotDir = process.env.UI_SCREENSHOTS ?? `/tmp/rw-notifications-${run}`;
const badge = (name) => `Number(document.querySelector('[data-badge="${name}"]')?.textContent.match(/\\d+/)?.[0] ?? 0)`;
const toast = (id) => `!!document.querySelector('[data-notification-id="${id}"]')`;
const poll = async () => { await page.eval('window.dispatchEvent(new Event("online"))'); await sleep(800); };
const api = (suffix = "") => page.eval(`fetch('/dashboard/aktualisierungen${suffix}').then(async r => ({status:r.status, cache:r.headers.get('Cache-Control'), data:await r.json()}))`);
try {
  await writeFile(faultFile, `const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/rest/v1/profiles')) throw new TypeError('Simulated local Supabase outage');
      return original(input, init);
    };`);
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === "page"); } catch { await sleep(200); }
  }
  if (!target) throw new Error("Chrome nicht erreichbar");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
  page = new Page(socket);
  await page.send("Page.enable"); await page.send("Runtime.enable"); await page.send("Network.enable");
  page.listeners.add(({method, params}) => { if (method === "Network.requestWillBeSent") networkRequests.push(new URL(params.request.url).pathname); });
  const makeUser = async (role) => {
    const email = `notify-${role}-${run}@example.com`;
    const user = must(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user;
    users.push(user.id);
    must(await admin.from("profiles").insert({ id: user.id, display_name: `Notification Test ${role}`, role }));
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    must(await client.auth.signInWithPassword({ email, password }));
    return { id: user.id, email, client };
  };
  const observer = await makeUser("dispatcher"), colleague = await makeUser("manager"), tech = await makeUser("technician");
  const newRequest = async (source = "website_form", overrides = {}) => {
    const row = must(await admin.from("requests").insert({
      source_event_key: `notify-${run}-${requests.length}`, request_number: "x", source, is_demo: true,
      company_name: `Notification Test ${requests.length}`, contact_name: "Erika Muster", business_email: "notify@example.com", phone_number: "+49 211 1",
      street_house_number: "Werkstr. 1", postal_code: "40210", city: "Düsseldorf", equipment_kind: "pump", service_kind: "inspection",
      requested_visit_date: "2035-03-05", description: "Benachrichtigungstest", customer_urgency: "zeitnah", safety_risk: "none_known",
      raw_payload: { test: run }, dispatcher_id: observer.id, intake_status: "processed", priority: "normal", ...overrides,
    }).select().single());
    requests.push(row.id); return row;
  };
  const incoming = async (requestId = null) => {
    const row = must(await admin.from("messages").insert({ request_id: requestId, direction: "incoming", kind: "customer_reply", status: "received",
      inbox_dispatcher_id: observer.id, subject: "Notification Test", body_text: "Kundenantwort", from_address: "notify@example.com", received_at: new Date().toISOString() }).select().single());
    messages.push(row.id); return row;
  };
  const initialRequest = await newRequest();
  await incoming(initialRequest.id); // initial old unread item establishes a silent baseline
  await page.send("Network.setCookies", { cookies: await loginCookies(observer.email) });
  await page.open(`${BASE}/dashboard/planung?anfrage=${initialRequest.id}&woche=2035-03-05`);
  await sleep(1200);
  check("Erstöffnung: aktuelle Zähler, keine alten Popups", await page.eval(`${badge("Anfragen mit ungelesenen Kundennachrichten")} === 1 && document.querySelectorAll('[data-notification-id]').length === 0`));
  const initial = await api();
  check("Route: angemeldet, privat/no-store", initial.status === 200 && /private/.test(initial.cache) && /no-store/.test(initial.cache));
  check("Dispatcher erhält keine fremden Systemwarnungen", initial.data.systemAlerts.length === 0);
  check("Manipulierter Zeitpunkt wird abgewiesen", (await api("?seit=ungueltig")).status === 400);
  await page.eval('window.__notificationSentinel = "survived"');
  // Choose a slot with genuine input/change events. It must survive both polling and a manual RSC refresh.
  check("Plantafelformular vorhanden", await page.eval('!!document.querySelector(".plan3__form")'));
  await page.eval(`(() => {
    const form = document.querySelector('.plan3__form');
    const select = form.querySelector('[name=technician_id]'); select.value = ${JSON.stringify(tech.id)}; select.dispatchEvent(new Event('change',{bubbles:true}));
    for (const [name,value] of [['date','2035-03-05'],['start','10:15'],['end','11:45']]) {
      const field=form.querySelector('[name='+name+']'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
    }
  })()`);
  const pickState = await page.eval('new URL(location.href).searchParams.toString()');
  const inbox = await incoming();
  // This first update deliberately uses only the actual 20-second interval, with no synthetic focus event.
  check("Anderer Bereich: neue E-Mail automatisch innerhalb eines Pollintervalls", await page.until(`${badge("offene E-Mails")} === ${initial.data.counts.inbox + 1} && ${toast(`message:${inbox.id}`)}`, 27000));
  check("CallbackAlerts hat keinen zweiten Abruf", !networkRequests.includes("/dashboard/rueckrufe"));
  check("Keine volle Neuladung; Auswahl und Uhrzeiten bleiben erhalten", await page.eval(`window.__notificationSentinel === 'survived' && document.querySelector('.plan3__form [name=start]').value === '10:15' && document.querySelector('.plan3__form [name=end]').value === '11:45' && new URL(location.href).searchParams.toString() === ${JSON.stringify(pickState)}`));
  check("Neue Daten werden bei ungespeicherter Auswahl separat angeboten", await page.eval("document.querySelector('.dash-update-status').textContent.includes('Daten aktualisieren')"));
  await mkdir(shotDir, { recursive: true });
  for (const [width, height] of [[390,844],[768,1024],[1440,900]]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 1000 });
    check(`Neue Hinweise und Aktualisieren-Schaltfläche @${width}: sichtbar, kein Seitenüberlauf`, await page.eval("(() => { const button=document.querySelector('.dash-update-status button');const rect=button?.getBoundingClientRect();return !!rect && rect.top >= 0 && rect.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth;})()"));
    const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(shotDir, `hinweise-${width}.png`), Buffer.from(shot.data,"base64"));
  }
  must(await colleague.client.rpc("archive_message", { message_id: inbox.id, reason: "other" }));
  await poll();
  check("Zweiter Mitarbeiter archiviert: Indikator sinkt im fremden Bereich", await page.until(`${badge("offene E-Mails")} === ${initial.data.counts.inbox}`, 27000));
  // The interval also runs with a hidden tab, preserving the existing background callback behaviour.
  await page.eval("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});true");
  const hiddenMail = await incoming();
  check("Hintergrund-Tab: gemeinsamer Timer aktualisiert Ereignisse weiterhin", await page.until(`${badge("offene E-Mails")} === ${initial.data.counts.inbox + 1} && ${toast(`message:${hiddenMail.id}`)}`, 27000));
  await page.eval("delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))");
  must(await colleague.client.rpc("archive_message", { message_id: hiddenMail.id, reason: "other" }));
  await poll();
  check("Rückkehr in den Tab: verarbeitete Hintergrund-E-Mail wird abgeglichen", await page.until(`${badge("offene E-Mails")} === ${initial.data.counts.inbox}`, 27000));
  const created = [];
  for (const source of ["website_form", "email", "phone_agent"]) created.push(await newRequest(source));
  await poll();
  check("Formular, E-Mail und Mira: neue Anfragen haben eigene Ereignis-IDs", await page.until(created.map(row => toast(`request:${row.id}`)).join(" && "), 8000));
  check("Neue Anfragen und ungelesene Antworten sind getrennt", await page.eval(`${badge("neu zu bearbeiten")} === ${initial.data.counts.newRequests + 3} && ${badge("Anfragen mit ungelesenen Kundennachrichten")} === 1`));
  const burst = [];
  for (let index = 0; index < 9; index++) burst.push(await newRequest());
  await poll();
  check("Mehr als acht neue Ereignisse: kein Hinweis geht verloren", await page.until(burst.map(row => toast(`request:${row.id}`)).join(" && "), 27000));
  // Repeated polling must not restore a dismissed event.
  await page.eval(`document.querySelector('[data-notification-id="message:${inbox.id}"] button')?.click()`);
  await poll(); await poll();
  check("Geschlossener Hinweis erscheint beim nächsten Abruf nicht erneut", !(await page.eval(toast(`message:${inbox.id}`))));

  await page.open(`${BASE}/dashboard/anfragen/${initialRequest.id}`);
  await page.until("!!document.querySelector('textarea[name=body_text]') && Object.keys(document.querySelector('textarea[name=body_text]').closest('form')).some(key => key.startsWith('__reactProps'))");
  await sleep(1200);
  await page.eval(`(() => { const field=document.querySelector('textarea[name=body_text]'); field.closest('details').open=true; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Ungespeicherter E-Mail-Entwurf 123');field.dispatchEvent(new Event('input',{bubbles:true}));field.blur(); })()`);
  const reply = await incoming(initialRequest.id);
  await poll();
  check("Zweite Antwort bei unveränderter Zahl ungelesener Anfragen löst Hinweis aus", await page.until(`${toast(`message:${reply.id}`)} && ${badge("Anfragen mit ungelesenen Kundennachrichten")} === 1`, 27000), JSON.stringify(await page.eval("({toasts:[...document.querySelectorAll('[data-notification-id]')].map(e=>e.dataset.notificationId),status:document.querySelector('.dash-update-status')?.textContent,text:document.querySelector('textarea[name=body_text]')?.value,dirty:document.querySelector('textarea[name=body_text]')?.closest('form').dataset.dashboardDirty})")));
  check("Ungespeicherter Text bleibt erhalten und blockiert automatische Seitenaktualisierung", await page.eval("document.querySelector('textarea[name=body_text]').value === 'Ungespeicherter E-Mail-Entwurf 123' && document.querySelector('.dash-update-status').textContent.includes('Daten aktualisieren')"));
  await page.eval("document.querySelector('.dash-update-status button')?.click()");
  check("Explizites Aktualisieren zeigt die neue Nachricht und behält den Entwurf", await page.until(`!!document.getElementById('nachricht-${reply.id}') && document.querySelector('textarea[name=body_text]')?.value === 'Ungespeicherter E-Mail-Entwurf 123'`, 27000));
  must(await colleague.client.rpc("mark_request_messages_read", { request_id: initialRequest.id }));
  await poll();
  check("Zweiter Mitarbeiter markiert gelesen: Antwortindikator verschwindet", await page.until(`${badge("Anfragen mit ungelesenen Kundennachrichten")} === 0`, 27000));

  // Failure must keep the last snapshot, and online must immediately catch up, once per identity.
  const beforeOffline = (await api()).data.counts;
  await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await poll();
  check("Offline: letzter bekannter Zähler bleibt statt Null", await page.eval(`${badge("neu zu bearbeiten")} === ${beforeOffline.newRequests} && document.querySelector('.dash-update-status').textContent.includes('unterbrochen')`));
  const offlineReply = await incoming(initialRequest.id);
  await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await poll();
  check("Verbindung wiederhergestellt: sofortiger Abruf und neue Antwort", await page.until(`${toast(`message:${offlineReply.id}`)} && ${badge("Anfragen mit ungelesenen Kundennachrichten")} === 1`, 27000));
  await page.eval(`document.querySelector('[data-notification-id="message:${offlineReply.id}"] button').click()`);
  await poll();
  check("Nach Wiederverbindung keine wiederholten Hinweise", !(await page.eval(toast(`message:${offlineReply.id}`))));

  // A clean list receives an RSC update, keeping its existing search/filter URL.
  await page.open(`${BASE}/dashboard/anfragen?ansicht=alle&suche=Notification`);
  const listRequest = await newRequest();
  await poll();
  check("Sauberer geöffneter Bereich aktualisiert Daten ohne Reload/Filterverlust", await page.until(`!!document.querySelector('a[href="/dashboard/anfragen/${listRequest.id}"]') && new URL(location.href).searchParams.get('suche') === 'Notification'`, 27000));
  // No old popup flood after a full opening. The list does not mark anything read; opening the request does (task-23-2).
  check("Liste markiert nicht gelesen", await page.eval(`${badge("Anfragen mit ungelesenen Kundennachrichten")} === 1 && !!document.querySelector('.dash-nav a[href="/dashboard/anfragen"] .dash-nav__dot--unread')`));
  await page.open(`${BASE}/dashboard/anfragen/${initialRequest.id}`);
  await sleep(900);
  check("Keine alten Hinweise nach voller Öffnung", await page.eval("document.querySelectorAll('[data-notification-id]').length === 0"));
  check("Anfrage öffnen markiert gelesen: roter Punkt weg, Übersicht der neuen Nachrichten bleibt, kein Knopf", await page.until(`${badge("Anfragen mit ungelesenen Kundennachrichten")} === 0 && !document.querySelector('.dash-nav a[href="/dashboard/anfragen"] .dash-nav__dot--unread') && !!document.getElementById('neue-nachrichten') && !document.body.textContent.includes('Als gelesen markieren')`, 8000));
  check("Auch in der Datenbank gelesen", must(await admin.from("messages").select("id").eq("request_id", initialRequest.id).eq("direction", "incoming").is("staff_read_at", null)).length === 0);

  // Customer changes and cancellation pass through the same integration RPC used by n8n.
  const visit = must(await admin.from("visits").insert({ request_id: created[1].id, technician_id: tech.id, created_by: colleague.id,
    scheduled_start: "2035-03-06T08:00:00Z", scheduled_end: "2035-03-06T10:00:00Z" }).select().single()); visits.push(visit.id);
  const wish = await incoming(created[1].id);
  must(await admin.rpc("apply_visit_reply", { message_id: wish.id, intent: "reschedule", confidence: 0.99, summary: "Bitte Termin verschieben" }));
  const change = must(await admin.from("visit_change_requests").select().eq("visit_id", visit.id).single()); changes.push(change.id);
  await poll();
  check("Verschiebewunsch: globaler Planungsindikator und verlinkter Hinweis", await page.until(`${badge("offene Terminwünsche")} === 1 && [...document.querySelectorAll('[data-notification-id]')].some(e => e.textContent.includes('Verschiebewunsch'))`, 27000));
  must(await colleague.client.rpc("close_visit_change", { change_id: change.id }));
  await poll();
  check("Zweiter Mitarbeiter erledigt Terminwunsch: Marke sinkt und Ergebnis erscheint", await page.until(`${badge("offene Terminwünsche")} === 0 && [...document.querySelectorAll('[data-notification-id]')].some(e => e.textContent.includes('Terminwunsch erledigt'))`, 27000));
  const cancellation = await incoming(created[1].id);
  must(await admin.rpc("apply_visit_reply", { message_id: cancellation.id, intent: "cancel_visit", confidence: 0.99, summary: "Bitte Termin absagen" }));
  await poll();
  check("Storno per E-Mail: verarbeitetes Ergebnis erscheint global", await page.until("[...document.querySelectorAll('[data-notification-id]')].some(e => e.textContent.includes('Termin storniert'))", 27000));
  // task-23-1: results fade out by themselves; anything to handle stays until its target is opened.
  check("Info-Hinweis verschwindet selbst, Verschiebewunsch bleibt", await page.until("![...document.querySelectorAll('[data-notification-id]')].some(e => e.textContent.includes('Termin storniert')) && [...document.querySelectorAll('[data-notification-id]')].some(e => e.textContent.includes('Verschiebewunsch'))", 10000));
  await page.eval(`window.next.router.push("/dashboard/planung?anfrage=${created[1].id}")`);
  check("Ziel selbst geöffnet: zugehöriger Hinweis schließt, andere bleiben", await page.until(`location.search.includes(${JSON.stringify(created[1].id)}) && ![...document.querySelectorAll('[data-notification-id]')].some(e => e.textContent.includes('Verschiebewunsch')) && ${toast(`message:${wish.id}`)}`, 8000));
  const call = must(await admin.from("phone_calls").insert({ conversation_id: `notification-test-${run}`, callback_needed: true, callback_urgent: true,
    callback_reason: "Test Rückruf", callback_number: "+49 211 1", is_demo: true, analysis: { firma: "Notification Test" } }).select().single()); calls.push(call.id);
  await poll();
  check("Rückruf: gemeinsamer Abruf aktualisiert Banner und Anrufe-Indikator", await page.until(`${badge("Rückrufbitten")} === 1 && !!document.querySelector('[data-call-id="${call.id}"]') && ${toast(`callback:call:${call.id}`)}`, 27000));
  must(await colleague.client.rpc("acknowledge_call_callback", { call_id: call.id }));
  await poll();
  check("Zweiter Mitarbeiter quittiert Rückruf: Banner und Marke verschwinden", await page.until(`${badge("Rückrufbitten")} === 0 && !document.querySelector('[data-call-id="${call.id}"]')`, 27000));
  const failed = must(await admin.from("messages").insert({ request_id: initialRequest.id, direction: "outgoing", kind: "clarification", status: "failed",
    to_address: "notify@example.com", subject: "Test Versandfehler", body_text: "Test", error_text: "Simulierter Testfehler" }).select().single()); messages.push(failed.id);
  await poll();
  check("Versandfehler: rollenabhängige Marke und Link zur Nachricht", await page.until(`${badge("Versandfehler")} === 1 && ${toast(`send-failed:${failed.id}`)}`, 27000));
  must(await admin.from("messages").update({ status: "draft" }).eq("id",failed.id));
  await poll();
  check("Behobener Versandfehler: Marke verschwindet", await page.until(`${badge("Versandfehler")} === 0`, 27000));

  // Role/assignment data boundaries with actual Supabase identities.
  const foreign = await newRequest("website_form", { dispatcher_id: null });
  const foreignMail = must(await admin.from("messages").insert({ direction: "incoming", kind: "customer_reply", status: "received", subject: "Fremd", body_text: "Fremd", request_id: foreign.id, from_address: "foreign@example.com", received_at: new Date().toISOString() }).select().single()); messages.push(foreignMail.id);
  const snapshot = (await api()).data;
  check("RLS: Dispatcher bekommt keine fremden Ereignisse", !snapshot.events.some(event => event.id === `request:${foreign.id}` || event.id === `message:${foreignMail.id}`));
  check("Supabase direkt: fremde Anfragen und Nachrichten bleiben unsichtbar", must(await observer.client.from("requests").select("id").eq("id", foreign.id)).length === 0 && must(await observer.client.from("messages").select("id").eq("id", foreignMail.id)).length === 0);
  await page.send("Network.clearBrowserCookies");
  check("Ohne Sitzung: Route gibt 401 statt Daten", (await api()).status === 401);
  await page.send("Network.setCookies", { cookies: await loginCookies(tech.email) });
  const technician = (await api()).data;
  check("Techniker: keine E-Mails, Erstbearbeitung oder Systemwarnungen", technician.role === "technician" && technician.counts.inbox === 0 && technician.counts.unreadRequests === 0 && technician.counts.newRequests === 0 && technician.events.every(event => !/^(message|request|system|send-failed):/.test(event.id)));
  check("Supabase direkt: Techniker liest keine E-Mails", must(await tech.client.from("messages").select("id")).length === 0);
  await page.send("Network.clearBrowserCookies");
  await page.send("Network.setCookies", { cookies: await loginCookies(colleague.email) });
  const warning = must(await admin.from("system_alerts").insert({ source: "app", severity: "warning", alert_key: `notification-test:${run}`, title: `Notification Test ${run}`, notified_at: new Date().toISOString() }).select().single()); warnings.push(warning.id);
  const managerSnapshot = (await api()).data;
  check("Manager bekommt die erlaubte Systemwarnung", managerSnapshot.systemAlerts.some(alert => alert.id === warning.id));
  // Responsive navigation/notices: screenshots at the project's three required sizes.
  await page.open(`${BASE}/dashboard/planung`);
  await mkdir(shotDir, { recursive: true });
  for (const [width, height] of [[390,844],[768,1024],[1440,900]]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 1000 });
    await sleep(150);
    check(`Navigation und Hinweise @${width}: kein horizontaler Seitenüberlauf`, await page.eval("document.documentElement.scrollWidth <= innerWidth"));
    const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(path.join(shotDir, `dashboard-${width}.png`), Buffer.from(shot.data,"base64"));
  }
  console.log(`Screenshots: ${shotDir}`);
  // An upstream outage must be 503, not "session revoked"/401: the same open page must recover without login.
  await startFaultServer(false);
  await page.open(`${faultUrl}/dashboard/planung`);
  await sleep(700);
  const beforeBackendFailure = (await api()).data;
  await page.eval("window.__upstreamProbe = 'kept'");
  await startFaultServer(true);
  check("Next → Supabase unterbrochen: 503 statt abgemeldeter Sitzung", (await api()).status === 503);
  await poll();
  check("Backend-Ausfall: letzter Indikator bleibt, keine erneute Anmeldung gefordert", await page.until(`${badge("neu zu bearbeiten")} === ${beforeBackendFailure.counts.newRequests} && document.querySelector('.dash-update-status').textContent.includes('unterbrochen') && !document.querySelector('.dash-update-status').textContent.includes('Erneut anmelden')`, 8000));
  await startFaultServer(false);
  const afterBackendFailure = await incoming(initialRequest.id);
  await poll();
  check("Backend wieder da: gleiche Sitzung und offener Bereich setzen Abruf ohne Reload fort", await page.until(`${toast(`message:${afterBackendFailure.id}`)} && window.__upstreamProbe === 'kept' && !document.querySelector('.dash-update-status').textContent.includes('unterbrochen')`, 27000));
  must(await admin.from("profiles").update({ is_active: false }).eq("id",colleague.id));
  check("Deaktiviertes Profil: vorhandene Sitzung bekommt keine Daten mehr", (await api()).status === 401);
  await poll();
  check("Entzogene Berechtigung wird auch im laufenden Client erkannt", await page.until("location.pathname === '/login' || document.querySelector('.dash-update-status')?.textContent.includes('Erneut anmelden')", 8000));
} finally {
  if (page) page.socket.close();
  chrome.kill();
  await stopFaultServer();
  // The existing demo-purge flag permits deletion of our demo audit events. Keep all guards/FKs active.
  const ids = (values) => values.map(id => { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Ungültige Fixture-ID"); return `'${id}'`; }).join(',');
  const requestIds = `array[${ids(requests)}]::uuid[]`, userIds = `array[${ids(users)}]::uuid[]`;
  const sql = `begin;
    set local rheinwerk.demo_purge = 'on';
    delete from public.visit_change_requests where request_id = any(${requestIds});
    delete from public.request_events where request_id = any(${requestIds});
    delete from public.automation_runs where request_id = any(${requestIds});
    delete from public.callback_requests where request_id = any(${requestIds});
    delete from public.phone_calls where id = any(array[${ids(calls)}]::uuid[]);
    delete from public.messages where request_id = any(${requestIds}) or id = any(array[${ids(messages)}]::uuid[]);
    delete from public.visits where request_id = any(${requestIds});
    delete from public.requests where id = any(${requestIds}) and is_demo;
    delete from public.system_alerts where id = any(array[${ids(warnings)}]::uuid[]);
    delete from public.profiles where id = any(${userIds});
    commit;`;
  execFileSync("docker", ["exec", "-i", process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_A.Sadkovojs_Project", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, stdio: ["pipe", "pipe", "pipe"] });
  for (const id of users) must(await admin.auth.admin.deleteUser(id));
  await sleep(500); await rm(profile,{recursive:true,force:true});
}
console.log(`Benachrichtigungen: ${failures ? failures + " Fehler" : "alle Prüfungen bestanden"}`);
if (failures) process.exitCode=1;
