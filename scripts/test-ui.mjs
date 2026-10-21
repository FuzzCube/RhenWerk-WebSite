// Browser checks of the dashboard UI in headless Chrome over the DevTools protocol (task-4-2):
// - no horizontal scrolling at 390×844, 768×1024 and 1440×900 for the dashboard areas of every role
// - a failed save keeps all inputs (validation error and simulated version conflict), success shows the save state
// - review actions of the request page (task-5-2) against the database: correction, draft, queue, release,
//   version conflict, rejection; runs as a temporary dispatcher on its own test requests (local data stays, like test:api)
// Usage: npm run build && npm run start, then npm run test:ui
//   APP_URL (default http://localhost:3000), CHROME_PATH (default: Google Chrome on macOS),
//   UI_SCREENSHOTS=<dir> additionally stores a screenshot per page and width.
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { deactivateTestAccounts } from "./demo/test-accounts.mjs";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.UI_SCREENSHOTS;
const password = process.env.DEMO_USER_PASSWORD;
if (!password) {
  console.error("DEMO_USER_PASSWORD wird benötigt (Demo-Nutzer, npm run demo:users).");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(BASE)) {
  console.error("Abbruch: test:ui läuft nur gegen eine lokale App.");
  process.exit(1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` – ${detail}`}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (text) => text.replace(/&quot;/g, '"').replace(/&amp;/g, "&");

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

const profile = await mkdtemp(path.join(tmpdir(), "rw-ui-"));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let page;
const testAccounts = [];
let cleanupClient = null;
try {
  let target;
  for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((item) => item.type === "page");
    } catch {
      await sleep(200);
    }
  }
  if (!target) throw new Error(`Chrome nicht erreichbar (${CHROME}). CHROME_PATH setzen.`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
  page = new Page(socket);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Network.enable");
  if (SHOTS) await mkdir(SHOTS, { recursive: true });

  const viewports = [
    { name: "390", width: 390, height: 844, mobile: true },
    { name: "768", width: 768, height: 1024, mobile: true },
    { name: "1440", width: 1440, height: 900, mobile: false },
  ];
  const roles = [
    { email: "admin.demo@example.com", pages: ["/dashboard/bausteine", "/dashboard/verwaltung", "detail:/dashboard/verwaltung", "detail:/dashboard/verwaltung/arbeitszeiten", "/dashboard/verwaltung/arbeitszeiten", "/dashboard/verwaltung/tarife", "/dashboard/verwaltung/einstellungen", "/dashboard/uebersicht", "/dashboard/anfragen", "/dashboard/posteingang", "/dashboard/kunden", "/dashboard/anrufe", "/dashboard/system"] },
    { email: "manager.demo@example.com", pages: ["/dashboard/uebersicht", "/dashboard/uebersicht?zeitraum=jahr", "/dashboard/rechnungen", "/dashboard/auswertung", "/dashboard/auswertung?bereich=warteschlangen", "/dashboard/auswertung?bereich=automatisierung", "/dashboard/planung", "/dashboard/anfragen", "detail:/dashboard/anfragen?arbeit=completed", "detail:/dashboard/anfragen?erstbearbeitung=needs_review", "/dashboard/posteingang", "/dashboard/posteingang?ansicht=zugeordnet", "/dashboard/kunden", "detail:/dashboard/kunden", "/dashboard/auswertung?bereich=telefon", "/dashboard/anrufe", "detail:/dashboard/anrufe", "/dashboard/system"] },
    { email: "dispo3.demo@example.com", pages: ["/dashboard/erstbearbeitung", "/dashboard/erstbearbeitung?tab=planung", "/dashboard/erstbearbeitung?tab=alle", "/dashboard/posteingang", "/dashboard/kunden", "/dashboard/anrufe", "detail:/dashboard/anrufe?ansicht=anfrage"] },
    { email: "technik1.demo@example.com", pages: ["/dashboard/heute", "/dashboard/kalender", "/dashboard/anfragen", "detail:/dashboard/anfragen", "einsatz:/dashboard/heute"] },
  ];

  console.log(`UI-Prüfung gegen ${BASE}\n\nKein horizontales Scrollen`);
  for (const role of roles) {
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies(role.email) });
    for (const viewport of viewports) {
      await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
      for (const entry of role.pages) {
        // "detail:<list>" opens the first request of that list
        let pathname = entry;
        if (entry.startsWith("detail:") || entry.startsWith("einsatz:")) {
          const [kind, list] = [entry.slice(0, entry.indexOf(":")), entry.slice(entry.indexOf(":") + 1)];
          await page.open(`${BASE}${list}`);
          const selector = kind === "einsatz" ? ".visit-card__open" : ".data-table tbody a";
          pathname = await page.eval(`document.querySelector(${JSON.stringify(selector)})?.getAttribute("href") ?? ""`);
          if (!pathname) { check(`${role.email.split(".")[0]} ${entry}: keine Anfrage gefunden`, false); continue; }
        }
        await page.open(`${BASE}${pathname}`);
        const result = await page.eval(`({ path: location.pathname, scroll: document.documentElement.scrollWidth, width: window.innerWidth })`);
        check(`${role.email.split(".")[0]} ${pathname} @${viewport.name}`, result.path === pathname.split(/[?#]/)[0] && result.scroll <= result.width, JSON.stringify(result));
        if (SHOTS) {
          const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
          await writeFile(path.join(SHOTS, `${role.email.split(".")[0]}-${entry.replace(/[^a-z0-9]+/gi, "_")}-${viewport.name}.png`), Buffer.from(shot.data, "base64"));
        }
      }
    }
  }

  // task-17-7/17-12: area "System" for the owner. Admin and manager see the same content; no code updates. task-17-10:
  // a test warning (marked as mailed, so that the running watchdog sends no e-mail) shows the banner on every page for
  // manager and admin, the list, and "Erledigt" for admin only; it is removed at the end.
  console.log("\nSystem: Zusammenfassung, Datensicherung, Systeme, Guthaben, Versionen, Warnungen");
  {
    const view = () => page.eval(`({
      nav: !!document.querySelector('.dash-nav a[href="/dashboard/system"]'),
      summary: document.querySelector(".system-summary__title")?.textContent ?? "",
      alerts: document.querySelectorAll(".system-alerts li").length,
      cards: [...document.querySelectorAll(".rw-card__title")].map((t) => t.textContent.replace(/\\s*\\d+$/, "")),
      buttons: [...document.querySelectorAll(".system-page button")].map((b) => b.textContent),
      openRows: [...document.querySelectorAll(".system-alerts-open tbody tr")].map((tr) => tr.textContent),
      resolvedRows: [...document.querySelectorAll(".system-alerts-resolved tbody tr")].map((tr) => tr.textContent),
      banner: !!document.querySelector(".system-alert-banner") && getComputedStyle(document.querySelector(".system-alert-banner")).display !== "none",
      monitors: [...document.querySelectorAll(".system-monitors > li")].map((li) => li.textContent),
      credit: document.querySelector(".system-credit")?.textContent ?? "",
      mainWidth: getComputedStyle(document.querySelector(".dash-main")).maxWidth,
      scroll: document.documentElement.scrollWidth, width: innerWidth })`);
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const testKey = `ui-test:${Date.now()}`;
    const testTitle = `UI-Testwarnung ${testKey.slice(8)}`;
    const raised = await admin.rpc("raise_alert", { source: "app", alert_key: testKey, severity: "warning", title: testTitle, detail: "Nur für test:ui" });
    await admin.rpc("mark_alert_notified", { alert_id: raised.data.alert_id });
    const { count: openAlerts } = await admin.from("system_alerts").select("id", { count: "exact", head: true }).is("resolved_at", null);
    const expected = openAlerts === 0 ? "Alles in Ordnung" : openAlerts === 1 ? "1 Punkt braucht Aufmerksamkeit" : `${openAlerts} Punkte brauchen Aufmerksamkeit`;
    const sections = ["Datensicherung", "Zustand der Systeme", "Guthaben externer Dienste", "Systemversionen", "Warnungen"];
    // Watchdog result (task-17-9): row of the phone assistant and its credit as stored in system_status.monitoring
    const { data: status } = await admin.from("system_status").select("monitoring").single();
    const mira = status.monitoring?.mira;
    const stateLabel = (entry) => !entry ? null : Date.now() - Date.parse(entry.checked_at) > 15 * 60_000 ? "Prüfung veraltet"
      : { ok: "In Ordnung", warning: "Warnung", critical: "Gestört", off: "Nicht eingerichtet" }[entry.state];
    const miraLabel = stateLabel(mira);
    const n8nLabel = stateLabel(status.monitoring?.n8n);
    const row = (view, label) => view.monitors.find((text) => text.includes(label)) ?? "";
    const creditText = mira?.credit ? `${mira.credit.remaining.toLocaleString("de-DE")} von ${mira.credit.limit.toLocaleString("de-DE")} Credits übrig` : null;
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
    await page.open(`${BASE}/dashboard/system`);
    const adminView = await view();
    check(`Admin: „System“ in der Navigation, Zusammenfassung „${expected}“ mit ${openAlerts} Warnung(en), fünf Abschnitte`,
      adminView.nav && adminView.summary === expected && adminView.alerts === openAlerts && sections.every((t) => adminView.cards.includes(t)), JSON.stringify(adminView));
    check(`  Automatisierung (n8n): ${n8nLabel ?? "noch keine Prüfung"}; Telefonassistent: ${miraLabel ?? "noch keine Prüfung"}${creditText ? `, ${creditText}` : ""}`,
      (n8nLabel ? row(adminView, "Automatisierung (n8n)").includes(n8nLabel) : !row(adminView, "Automatisierung (n8n)"))
        && (miraLabel ? row(adminView, "Telefonassistent (Mira)").includes(miraLabel) : !row(adminView, "Telefonassistent (Mira)")),
      JSON.stringify({ monitors: adminView.monitors, credit: adminView.credit }));
    if (creditText) check("  Guthaben wie gemeldet, mit Tarif und Schwellwert", adminView.credit.includes(creditText) && adminView.credit.includes("Warnung unter"), adminView.credit);
    check("  nur „Erledigt“ je offener Warnung, keine Code-Updates, Breite wie die übrigen Bereiche (1680 px), Hinweis oben ausgeblendet",
      adminView.buttons.length === openAlerts && adminView.buttons.every((b) => b === "Erledigt") && !adminView.cards.some((t) => ["Versionen", "Verlauf", "Aktuelle Version"].includes(t))
        && adminView.mainWidth === "1680px" && !adminView.banner, JSON.stringify(adminView));
    check("  Testwarnung in „Offene Warnungen“ mit Quelle", adminView.openRows.some((text) => text.includes(testTitle) && text.includes("Website und Dashboard")), JSON.stringify(adminView.openRows));
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("manager.demo@example.com") });
    for (const width of [390, 768, 1440]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
      await page.open(`${BASE}/dashboard/system`);
      const managerView = await view();
      check(`  Manager @${width}: gleiche Inhalte, ohne „Erledigt“, kein Querscrollen`,
        managerView.summary === expected && sections.every((t) => managerView.cards.includes(t)) && managerView.buttons.length === 0
          && managerView.openRows.some((text) => text.includes(testTitle)) && managerView.scroll <= managerView.width, JSON.stringify(managerView));
    }
    // Banner on another page: manager yes, dispatcher no
    const bannerOn = () => page.eval(`({ shown: !!document.querySelector(".system-alert-banner"), text: document.querySelector(".system-alert-banner")?.textContent ?? "",
      link: document.querySelector(".system-alert-banner a")?.getAttribute("href") ?? "", scroll: document.documentElement.scrollWidth, width: innerWidth })`);
    for (const width of [390, 1440]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
      await page.open(`${BASE}/dashboard/uebersicht`);
      const banner = await bannerOn();
      check(`  Manager @${width} auf der Übersicht: Hinweis mit Anzahl und Link zur Liste`,
        banner.shown && banner.text.includes(openAlerts === 1 ? "1 Warnung im System" : `${openAlerts} Warnungen im System`) && banner.link === "/dashboard/system#system-warnungen" && banner.scroll <= banner.width, JSON.stringify(banner));
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("dispo1.demo@example.com") });
    await page.open(`${BASE}/dashboard/erstbearbeitung`);
    check("  Dispatcher: kein Hinweis auf Systemwarnungen", !(await bannerOn()).shown);
    // Admin closes the test warning by hand
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
    await page.open(`${BASE}/dashboard/system`);
    await page.eval(`document.querySelector('button[aria-label="Erledigt: ${testTitle}"]').click()`);
    const moved = await page.until(`[...document.querySelectorAll(".system-alerts-resolved tbody tr")].some((tr) => tr.textContent.includes(${JSON.stringify(testTitle)}) && tr.textContent.includes("erledigt von"))
      && ![...document.querySelectorAll(".system-alerts-open tbody tr")].some((tr) => tr.textContent.includes(${JSON.stringify(testTitle)}))`, 10000);
    const { data: stored } = await admin.from("system_alerts").select("resolved_reason, resolved_by").eq("alert_key", testKey).single();
    check("  Admin: „Erledigt“ verschiebt die Warnung nach „Behoben“ (von Hand, mit Person)", moved && stored?.resolved_reason === "manual" && Boolean(stored?.resolved_by), JSON.stringify(stored));
    await admin.from("system_alerts").delete().eq("alert_key", testKey);
  }

  console.log("\nÜbersicht (Admin): Kennzahlen führen zu passenden Listen");
  {
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const overview = `${BASE}/dashboard/uebersicht?zeitraum=monat`;
    await page.open(overview);
    const tiles = await page.eval(`Object.fromEntries([...document.querySelectorAll("[data-kpi]")].map((tile) => [tile.dataset.kpi, { value: tile.dataset.value, href: tile.querySelector(".rw-kpi__link")?.getAttribute("href") ?? null }]))`);
    check("16 Kennzahlen, jede mit Listen-Link", Object.keys(tiles).length === 16 && Object.values(tiles).every((tile) => tile.href), Object.keys(tiles).join(","));
    check("Höchstens 4 Kacheln sichtbar, weitere hinter „Weitere Kennzahlen anzeigen“", await page.eval(`document.querySelectorAll("[data-kpis=main] [data-kpi]").length === 4 && !!document.querySelector(".rw-kpi-more")`));
    // task-11-1: in every row of the further metrics, values and chips share one line, whatever the label height
    for (const width of [1440, 768]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const rows = await page.eval(`(() => {
        const more = document.querySelector(".rw-kpi-more"); more.open = true;
        const rows = new Map();
        for (const tile of more.querySelectorAll(".rw-kpi-compact")) {
          const top = Math.round(tile.getBoundingClientRect().top);
          const at = (selector) => Math.round(tile.querySelector(selector).getBoundingClientRect().top);
          rows.set(top, [...(rows.get(top) ?? []), [at(".rw-kpi-compact__value"), at(".rw-delta")]]);
        }
        return [...rows.values()].map((row) => row.every(([value, chip]) => value === row[0][0] && chip === row[0][1]));
      })()`);
      check(`Weitere Kennzahlen bündig bei ${width} px (${rows.length} Zeilen)`, rows.length > 1 && rows.every(Boolean));
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const listCount = async (href) => {
      await page.open(`${BASE}${href}`);
      return page.eval(`(() => { const sum = document.querySelector("[data-sum=gross]"); if (sum) return sum.textContent.replace(/[^0-9,]/g, "").replace(",", "."); const text = document.querySelector(".result-count")?.textContent ?? ""; return (text.match(/^[\\d.]+/) ?? ["0"])[0].replace(/\\./g, ""); })()`);
    };
    // Counts and sums of the linked lists equal the KPI value (current period: snapshots equal the current lists)
    for (const key of ["received", "intake_completed", "completed", "open_requests", "invoiced_gross", "payments_received", "open_receivables", "overdue_receivables"]) {
      const tile = tiles[key];
      const listed = tile?.href ? await listCount(tile.href) : null;
      check(`  ${key}: Liste ${listed} = Kennzahl ${tile?.value}`, tile && Number(listed) === Number(tile.value), tile?.href);
    }
    await page.open(overview);
    // Period control sits at the block it filters (task-10-3)
    const note = `document.querySelector("section[aria-labelledby=z-period] .rw-zone__note")?.textContent ?? ""`;
    const title = (await page.eval(note)).split(" · ")[0];
    // task-15-8: the period zones stay while the previous period loads (no placeholders, control stays)
    await page.eval(`(() => { const seen = { busy: false, placeholder: false, lostControl: false }; window.__switch = seen; const look = () => { if (document.querySelector(".pending-area[aria-busy]")) seen.busy = true; if (document.querySelector(".pending-area .dash-loading")) seen.placeholder = true; if (!document.querySelector("section[aria-labelledby=z-period] .rw-period")) seen.lostControl = true; }; new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true }); })()`);
    await page.eval(`document.querySelector('.rw-period a[aria-label="Vorheriger Zeitraum"]').click()`);
    const moved = await page.until(`location.search.includes("datum=") && (${note}) !== "" && !(${note}).startsWith(${JSON.stringify(title)}) && !document.querySelector(".pending-area[aria-busy]")`);
    check(`Zeitraum zurück: ${title} → vorheriger Monat`, moved, await page.eval(`location.search`));
    const overviewSwitch = await page.eval(`window.__switch`);
    check("  Übersicht: Zeitraumwechsel ohne Ladeplatzhalter, Schalter bleibt, Bereich währenddessen aria-busy", overviewSwitch.busy && !overviewSwitch.placeholder && !overviewSwitch.lostControl, JSON.stringify(overviewSwitch));
    check("  vergangener Monat ist vollständig, Weiter-Pfeil vorhanden", await page.eval(`!!document.querySelector('.rw-period a[aria-label="Nächster Zeitraum"]') && !(${note}).includes("laufend")`));
  }

  console.log("\nAuswertung: Diagramme aus Datenbankdaten");
  {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    // One tab per area; only the selected area is rendered
    const figures = [];
    const tabs = { durchsatz: 3, warteschlangen: 4, finanzen: 1, automatisierung: 2, telefon: 1 };
    for (const [area, expected] of Object.entries(tabs)) {
      await page.open(`${BASE}/dashboard/auswertung?bereich=${area}`);
      await page.until(`document.querySelectorAll(".figure .recharts-surface").length >= ${expected}`, 10000);
      const shown = await page.eval(`({ current: document.querySelector('.side-menu--wide [aria-current="page"]')?.textContent, figures: [...document.querySelectorAll("figure.figure")].map((f) => ({ id: f.dataset.chart, svg: !!f.querySelector(".recharts-surface"), marks: f.querySelectorAll(".recharts-line-curve, .recharts-bar-rectangle").length, table: f.querySelectorAll(".figure__table tbody tr").length })) })`);
      check(`  Reiter ${area}: nur ${expected} Diagramm(e) dieses Bereichs`, shown.figures.length === expected && shown.current?.toLowerCase() === area, JSON.stringify(shown));
      figures.push(...shown.figures);
    }
    check("11 Diagramme (4 Warteschlangen als Einzeldiagramme) mit Datentabelle gezeichnet", figures.length === 11 && figures.every((f) => f.svg && f.marks > 0 && f.table > 0), JSON.stringify(figures));
    await page.open(`${BASE}/dashboard/auswertung`);
    await page.until(`document.querySelectorAll(".figure .recharts-surface").length >= 3`, 10000);
    // Current month in the flow table equals a direct count in the database (Europe/Berlin)
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "longOffset" }).formatToParts(new Date(`${parts.year}-${parts.month}-01T12:00:00Z`)).find((p) => p.type === "timeZoneName").value.replace("GMT", "") || "+00:00";
    const monthStart = new Date(`${parts.year}-${parts.month}-01T00:00:00${offset}`).toISOString();
    const { count } = await admin.from("requests").select("id", { count: "exact", head: true }).gte("created_at", monthStart);
    const tableValue = await page.eval(`(() => { const rows = [...document.querySelectorAll("#flow-chart .figure__table tbody tr")]; const last = rows.at(-1); return last ? last.querySelectorAll("td")[1].textContent.replace(/\\D/g, "") : null; })()`);
    check(`  Eingänge des laufenden Monats: Tabelle ${tableValue} = Datenbank ${count}`, Number(tableValue) === count);
    // Legend toggles (task-12-5): a click hides a series (with its dashed running segment), the y-axis follows the
    // visible series, the last visible series stays, the data table keeps every series
    const legendState = `(() => { const f = document.querySelector("#flow-chart"); const ticks = [...f.querySelectorAll(".recharts-yAxis-tick-labels text")].map((t) => Number(t.textContent.replace(/\\D/g, ""))); return { lines: f.querySelectorAll(".recharts-line-curve").length, top: Math.max(...ticks), pressed: [...f.querySelectorAll(".rw-legend--toggle button")].map((b) => b.getAttribute("aria-pressed")).join(","), lastLocked: f.querySelector('.rw-legend--toggle [data-series="completed"]')?.getAttribute("aria-disabled"), columns: f.querySelectorAll(".figure__table thead th").length }; })()`;
    const pressSeries = (key) => page.eval(`document.querySelector('#flow-chart .rw-legend--toggle [data-series="${key}"]').click()`);
    const allShown = await page.eval(legendState);
    await pressSeries("received");
    await pressSeries("intake_completed");
    await sleep(300);
    const oneShown = await page.eval(legendState);
    if (SHOTS) {
      for (const width of [390, 1440]) {
        await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
        await sleep(400);
        await page.eval(`document.querySelector("#flow-chart").scrollIntoView({ block: "start", behavior: "instant" })`);
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(SHOTS, `legende-umschalten-${width}.png`), Buffer.from(shot.data, "base64"));
      }
    }
    await pressSeries("completed");
    await sleep(200);
    const stillOne = await page.eval(legendState);
    await pressSeries("received");
    await pressSeries("intake_completed");
    await sleep(300);
    const restored = await page.eval(legendState);
    check("  Legende: Reihen aus- und einblenden, y-Achse folgt, letzte Reihe bleibt, Tabelle vollständig",
      allShown.pressed === "true,true,true" && oneShown.pressed === "false,false,true" && oneShown.lines < allShown.lines && oneShown.top < allShown.top
        && oneShown.lastLocked === "true" && stillOne.pressed === "false,false,true" && restored.pressed === "true,true,true" && restored.lines === allShown.lines && oneShown.columns === allShown.columns,
      JSON.stringify({ allShown, oneShown, stillOne, restored }));
    // task-15-6: the period control sits in the card it filters, monthly charts switch between 12 and 24 months
    const controls = `({ head: !!document.querySelector(".side-page__head .rw-period"), comparison: !!document.querySelector("#comparison-chart .rw-period__step"), runs: !!document.querySelector("#runs .rw-period__step"), months: [...document.querySelectorAll('nav[aria-label^="Monate"] a[aria-current="page"]')].map((a) => a.textContent), rows: document.querySelectorAll("#flow-chart .figure__table tbody tr, #share-chart .figure__table tbody tr").length })`;
    const durchsatz = await page.eval(controls);
    check("  Durchsatz: Zeitraum in der Karte „kumuliert“, nicht im Seitenkopf; Monatsdiagramm 24 Monate", !durchsatz.head && durchsatz.comparison && durchsatz.months.join() === "24 Monate" && durchsatz.rows === 24, JSON.stringify(durchsatz));
    // task-15-7: compact controls (32 px) keep title and period control of the card in one row at 1440 px
    const row = await page.eval(`(() => { const box = (el) => el.getBoundingClientRect(); const title = box(document.querySelector("#comparison-chart .rw-card__title")); const nav = box(document.querySelector("#comparison-chart .rw-period")); const step = box(document.querySelector("#comparison-chart .rw-period__step")); return { title: document.querySelector("#comparison-chart .rw-card__title").textContent, sameRow: nav.top < title.bottom && title.top < nav.bottom, step: Math.round(step.height) }; })()`);
    check("  Karte „Eingänge kumuliert“: Titel und kompakter Zeitraumschalter (32 px) in einer Zeile @1440", row.title === "Eingänge kumuliert" && row.sameRow && row.step === 32, JSON.stringify(row));
    // task-15-8: a new period keeps the cards (no loading placeholders, control stays), the area is busy meanwhile
    const watchSwitch = `(() => { const seen = { busy: false, placeholder: false, lostControl: false }; window.__switch = seen; const look = () => { if (document.querySelector(".pending-area[aria-busy]")) seen.busy = true; if (document.querySelector(".pending-area .dash-loading")) seen.placeholder = true; if (!document.querySelector("#comparison-chart .rw-period, section[aria-labelledby=z-period] .rw-period")) seen.lostControl = true; }; new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true }); })()`;
    await page.eval(watchSwitch);
    await page.eval(`[...document.querySelectorAll("#comparison-chart .rw-period__kinds a")].find((a) => a.textContent === "Woche").click()`);
    await page.until(`location.search.includes("zeitraum=woche") && document.querySelector("#comparison-chart .rw-card__title") && !document.querySelector(".pending-area[aria-busy]") && document.querySelector('#comparison-chart .rw-period__kinds a[aria-current="page"]')?.textContent === "Woche"`, 15000);
    const switched = await page.eval(`({ ...window.__switch, legend: document.querySelector("#comparison-chart .rw-legend")?.textContent ?? "" })`);
    check("  Zeitraumwechsel ohne Neuaufbau: keine Ladeplatzhalter, Schalter bleibt, Bereich währenddessen aria-busy", switched.busy && !switched.placeholder && !switched.lostControl && /KW/.test(switched.legend), JSON.stringify(switched));
    await page.open(`${BASE}/dashboard/auswertung`);
    await page.until(`document.querySelectorAll(".figure .recharts-surface").length >= 3`, 10000);
    await page.eval(`[...document.querySelectorAll('#flow-chart nav[aria-label^="Monate"] a')].find((a) => a.textContent === "12 Monate").click()`);
    await page.until(`location.search.includes("monate=12") && document.querySelectorAll("#flow-chart .figure__table tbody tr").length === 12`, 10000);
    const kept = await page.eval(`({ rows: document.querySelectorAll("#flow-chart .figure__table tbody tr").length, step: document.querySelector("#comparison-chart .rw-period__step").getAttribute("href"), menu: document.querySelector('.side-menu--wide a[href*="bereich=automatisierung"]')?.getAttribute("href") })`);
    check("  12 Monate: Tabelle mit 12 Zeilen; Zeitraum-Links und Bereiche behalten die Auswahl", kept.rows === 12 && kept.step.includes("monate=12") && kept.menu?.includes("monate=12"), JSON.stringify(kept));
    await page.open(`${BASE}/dashboard/auswertung?bereich=automatisierung&monate=12`);
    await page.until(`!!document.querySelector("#share-chart .recharts-surface")`, 10000);
    const automation = await page.eval(controls);
    check("  Automatisierung: Zeitraum in der Karte „Läufe“, Diagramme mit 12 Monaten", !automation.head && automation.runs && automation.months.join() === "12 Monate,12 Monate" && automation.rows === 12, JSON.stringify(automation));
    if (SHOTS) {
      for (const width of [390, 768, 1440]) {
        await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
        for (const [name, url, anchor] of [["durchsatz", "/dashboard/auswertung?monate=12", "#flow-chart"], ["kumuliert", "/dashboard/auswertung", "#comparison-chart"], ["laeufe", "/dashboard/auswertung?bereich=automatisierung", "#runs"], ["uebersicht", "/dashboard/uebersicht", "section[aria-labelledby=z-period]"], ["telefon", "/dashboard/auswertung?bereich=telefon", ".side-page__head"]]) {
          await page.open(`${BASE}${url}`);
          await page.until(`!!document.querySelector("${anchor}")`, 10000);
          await sleep(400);
          // Below the sticky navigation so the card header with its control is visible
          await page.eval(`window.scrollTo({ top: document.querySelector("${anchor}").getBoundingClientRect().top + window.scrollY - 130, behavior: "instant" })`);
          const shot = await page.send("Page.captureScreenshot", { format: "png" });
          await writeFile(path.join(SHOTS, `auswertung-${name}-${width}.png`), Buffer.from(shot.data, "base64"));
        }
      }
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }
    // Tooltip of the time savings shows count and baseline
    await page.open(`${BASE}/dashboard/auswertung?bereich=automatisierung`);
    await page.until(`!!document.querySelector("#savings-chart .recharts-surface")`, 10000);
    const box = await page.eval(`(() => { const bars = [...document.querySelectorAll("#savings-chart .recharts-bar-rectangle path, #savings-chart .recharts-bar-rectangle")].map((b) => b.getBoundingClientRect()).filter((r) => r.height > 2); const r = bars.at(-2) ?? bars.at(-1); if (!r) return null; document.querySelector("#savings-chart").scrollIntoView({ block: "center", behavior: "instant" }); return null; })()`);
    await sleep(300);
    const target = await page.eval(`(() => { const bars = [...document.querySelectorAll("#savings-chart .recharts-bar-rectangle path")].map((b) => b.getBoundingClientRect()).filter((r) => r.height > 2); const r = bars.at(-2) ?? bars.at(-1); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    if (target) await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
    const tip = target && await page.until(`!!document.querySelector("#savings-chart [data-savings-detail]")`, 3000) ? await page.eval(`document.querySelector("#savings-chart [data-savings-detail]").textContent`) : "";
    check("  Tooltip Zeitersparnis zeigt Anzahl und Basiswert", /\d+ Anfragen × Basiswert 15 min/.test(tip), `${tip} ${box ?? ""}`);
    // Telefon (task-13-7): figure "Anrufe" equals the evaluated calls of the running month in the database
    await page.open(`${BASE}/dashboard/auswertung?bereich=telefon`);
    await page.until(`!!document.querySelector('[data-phone-figure="calls"]')`, 10000);
    const { count: callCount } = await admin.from("phone_calls").select("id", { count: "exact", head: true }).not("analyzed_at", "is", null).gte("started_at", monthStart);
    const phone = await page.eval(`({ figures: document.querySelectorAll("[data-phone-figure]").length, calls: document.querySelector('[data-phone-figure="calls"] .rw-glance__value')?.textContent.replace(/\\D/g, ""), categories: document.querySelectorAll("#phone-categories tbody tr").length })`);
    check(`  Telefon: 8 Kennzahlen, Anrufe ${phone.calls} = Datenbank ${callCount}, Tabelle der Anliegen`, phone.figures === 8 && Number(phone.calls) === callCount && phone.categories > 0, JSON.stringify(phone));
    // task-12-6: only the phone figures, concerns collapsed, period buttons keep their place when paging back
    const layout = await page.eval(`({ glance: document.querySelectorAll(".rw-glance:not([data-phone-figure])").length, closed: document.querySelector("details#phone-categories")?.open === false })`);
    check("  Telefon: keine allgemeinen Karten, Anliegen eingeklappt", layout.glance === 0 && layout.closed, JSON.stringify(layout));
    const buttons = `[...document.querySelectorAll(".insights__period .rw-period__step, .insights__period .rw-period__kinds a")].map((el) => { const r = el.getBoundingClientRect(); return Math.round(r.x) + ":" + Math.round(r.y); }).join(",")`;
    for (const width of [1440, 768, 390]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
      await page.open(`${BASE}/dashboard/auswertung?bereich=telefon`);
      const now = await page.eval(buttons);
      const previous = await page.eval(`document.querySelector(".insights__period .rw-period__step").getAttribute("href")`);
      await page.open(`${BASE}${previous}`);
      const back = await page.eval(`({ at: ${buttons}, current: !!document.querySelector(".insights__period .rw-period__current") })`);
      check(`  Zeitraumtasten bleiben beim Zurückblättern an ihrer Position @${width}`, back.current && back.at === now, JSON.stringify({ now, back }));
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  }

  console.log("\nAnfragenliste sortieren (task-12-12)");
  {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    // Same order as the list: sorted column (empty last), newest receipt, id
    const expected = async (column, ascending, page = 1) => {
      let query = admin.from("requests").select("request_number");
      if (column) query = query.order(column, { ascending, nullsFirst: false });
      const { data } = await query.order("created_at", { ascending: column ? false : ascending }).order("id").range((page - 1) * 25, page * 25 - 1);
      return data.map((row) => row.request_number).join(",");
    };
    const shown = () => page.eval(`({
      numbers: [...document.querySelectorAll(".data-table tbody tr td:first-child .mono")].map((el) => el.textContent).join(","),
      sorted: [...document.querySelectorAll(".data-table th[aria-sort]")].map((th) => th.textContent.replace(/[↑↓↕]/g, "").trim() + ":" + th.getAttribute("aria-sort")).join(","),
      label: document.querySelector(".req-sort summary strong")?.textContent,
      url: location.search,
    })`);
    const clickHeader = async (text) => {
      const before = await page.eval("location.search");
      await page.eval(`[...document.querySelectorAll(".data-table th a.data-table__sort")].find((a) => a.textContent.includes(${JSON.stringify(text)})).click()`);
      await page.until(`location.search !== ${JSON.stringify(before)} && !!document.querySelector(".data-table tbody tr")`, 10000);
      await sleep(300);
    };
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.open(`${BASE}/dashboard/anfragen?ansicht=alle`);
    const initial = await shown();
    check("Standard: Eingang, neueste zuerst (wie Datenbank)", initial.sorted === "Eingang:descending" && initial.label === "Eingang, neueste zuerst" && initial.numbers === await expected(null, false), JSON.stringify(initial).slice(0, 300));
    await clickHeader("Priorität");
    const high = await shown();
    check("  Klick auf „Priorität“: höchste zuerst, Pfeil und aria-sort", high.url.includes("sortierung=prioritaet-ab") && high.sorted === "Priorität:descending" && high.numbers === await expected("priority", false), JSON.stringify(high).slice(0, 300));
    await clickHeader("Priorität");
    const low = await shown();
    check("  zweiter Klick: niedrigste zuerst", low.url.includes("sortierung=prioritaet-auf") && low.sorted === "Priorität:ascending" && low.numbers === await expected("priority", true), JSON.stringify(low).slice(0, 300));
    await page.eval(`document.querySelector('.pagination a[rel="next"]').click()`);
    await page.until(`location.search.includes("seite=2")`, 10000);
    await sleep(300);
    const second = await shown();
    check("  Seite 2 behält die Sortierung", second.url.includes("sortierung=prioritaet-auf") && second.numbers === await expected("priority", true, 2), JSON.stringify(second).slice(0, 300));
    await clickHeader("Kunde");
    const customers = await shown();
    check("  Kunde A–Z, zurück auf Seite 1", customers.url.includes("sortierung=kunde-auf") && !customers.url.includes("seite=") && customers.numbers === await expected("company_name", true), JSON.stringify(customers).slice(0, 300));
    await page.open(`${BASE}/dashboard/anfragen?ansicht=alle&sortierung=dispatcher-auf`);
    const byDispatcher = await shown();
    check("  Admin: nach Dispatcher sortierbar", byDispatcher.sorted === "Dispatcher:ascending", JSON.stringify(byDispatcher).slice(0, 200));
    // The search keeps the sorting
    await page.open(`${BASE}/dashboard/anfragen?ansicht=alle&sortierung=prioritaet-ab`);
    await page.eval(`(() => { const input = document.querySelector("#filter-suche"); input.value = "GmbH"; input.form.requestSubmit(); })()`);
    await page.until(`location.search.includes("suche=GmbH")`, 10000);
    check("  Suche behält die Sortierung", (await page.eval("location.search")).includes("sortierung=prioritaet-ab"));
    for (const width of [1440, 768, 390]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
      await page.open(`${BASE}/dashboard/anfragen?ansicht=alle&sortierung=prioritaet-ab`);
      await page.eval(`document.querySelector(".req-sort").open = true`);
      const menu = await page.eval(`({ items: document.querySelectorAll(".req-sort a").length, current: document.querySelector('.req-sort a[aria-current="true"]')?.textContent, scroll: document.documentElement.scrollWidth, width: innerWidth, visible: !!document.querySelector(".req-sort summary").offsetParent })`);
      check(`  Menü „Sortiert“ @${width}: 12 Möglichkeiten, aktuelle markiert, kein horizontales Scrollen`, menu.visible && menu.items === 12 && menu.current === "Priorität, höchste zuerst" && menu.scroll <= menu.width, JSON.stringify(menu));
      if (SHOTS) {
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(SHOTS, `anfragen-sortierung-${width}.png`), Buffer.from(shot.data, "base64"));
      }
    }
    await page.eval(`[...document.querySelectorAll(".req-sort a")].find((a) => a.textContent === "Kunde, Z–A").click()`);
    await page.until(`location.search.includes("sortierung=kunde-ab")`, 10000);
    check("  Smartphone: Auswahl „Kunde, Z–A“ sortiert", (await shown()).numbers === await expected("company_name", false));
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("dispo1.demo@example.com") });
    await page.open(`${BASE}/dashboard/anfragen?ansicht=alle&sortierung=dispatcher-auf`);
    const dispo = await shown();
    check("  Dispatcher: ohne Dispatcher-Spalte keine Sortierung danach (Standard)", dispo.label === "Eingang, neueste zuerst" && !(await page.eval(`[...document.querySelectorAll(".req-sort a")].some((a) => a.textContent.startsWith("Dispatcher"))`)), JSON.stringify(dispo).slice(0, 200));
  }

  console.log("\nAnfrage aus Sicht des Technikers: eigener Einsatz oben, nur technische Angaben");
  {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const { data: anna } = await admin.from("profiles").select("id").eq("display_name", "Anna Lehmann").single();
    const { data: visit } = await admin.from("visits").select("id, request_id").eq("technician_id", anna.id).neq("status", "cancelled").order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
    if (!visit) check("Einsatz von Anna Lehmann vorhanden", false);
    else {
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies("technik2.demo@example.com") });
      await page.open(`${BASE}/dashboard/anfragen/${visit.request_id}`);
      const view = await page.eval(`({
        hero: document.querySelector(".request-visit .request-visit__open")?.getAttribute("href"),
        first: document.querySelector(".request-visit")?.compareDocumentPosition(document.getElementById("zusammenfassung")) === Node.DOCUMENT_POSITION_FOLLOWING,
        fristen: !!document.getElementById("fristen-heading"),
        slaCheck: document.getElementById("anlage")?.textContent.includes("SLA geprüft"),
        intern: document.getElementById("kontakt")?.textContent.includes("(Dispatcher)"),
        history: document.querySelector("#verlauf details") ? !document.querySelector("#verlauf details").open : false,
      })`);
      check("Einsatz-Karte vor dem Anliegen, verlinkt den eigenen Einsatz", view.hero?.startsWith("/dashboard/einsatz/") && view.first, JSON.stringify(view));
      check("  ohne Zuständigkeit/Fristen und SLA-Prüfung, Dispatcher im Kontakt, Verlauf zugeklappt", !view.fristen && !view.slaCheck && view.intern && view.history, JSON.stringify(view));
      const { data: state } = await admin.from("requests").select("work_status, technician_id, invoices(id)").eq("id", visit.request_id).single();
      const laterExpected = state.technician_id === anna.id && !["completed", "cancelled"].includes(state.work_status) && !(state.invoices ?? []).length;
      const later = await page.eval(`(() => { const b = document.querySelector(".request-next--later button"); return b ? b.disabled : null; })()`);
      check(`  Rechnung erstellen ${laterExpected ? "sichtbar, aber inaktiv" : "nicht als inaktiver Schritt"} (Arbeit: ${state.work_status})`, laterExpected ? later === true : later === null, String(later));
      // Completed request with an invoice: the slot of the next step says the work is done
      const { data: tobias } = await admin.from("profiles").select("id").eq("display_name", "Tobias Krüger").single();
      const { data: done } = await admin.from("requests").select("id, invoices!inner(invoice_number)").eq("technician_id", tobias.id).eq("work_status", "completed").neq("invoices.status", "draft").limit(1).maybeSingle();
      if (done) {
        await page.send("Network.clearBrowserCookies");
        await page.send("Network.setCookies", { cookies: await loginCookies("technik1.demo@example.com") });
        await page.open(`${BASE}/dashboard/anfragen/${done.id}`);
        const closed = await page.eval(`document.getElementById("aktionen")?.textContent ?? ""`);
        const number = (Array.isArray(done.invoices) ? done.invoices[0] : done.invoices).invoice_number;
        check("  abgeschlossene Anfrage: „Arbeit abgeschlossen“ mit Rechnungsstatus", closed.includes("Arbeit abgeschlossen") && closed.includes(number), closed);
      }
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies("manager.demo@example.com") });
      await page.open(`${BASE}/dashboard/anfragen/${visit.request_id}`);
      check("  Manager sieht die Anfrage unverändert (Fristen, keine Einsatz-Karte)", await page.eval(`!!document.getElementById("fristen-heading") && !document.querySelector(".request-visit")`));
    }
  }

  console.log("\nÜbersicht Admin: Handlungsbedarf als Kacheln mit aufklappbaren Details");
  {
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
    await page.open(`${BASE}/dashboard/uebersicht`);
    await page.until(`document.querySelectorAll(".rw-tile").length === 4`, 10000);
    const state = () => page.eval(`({ open: [...document.querySelectorAll(".rw-tiles__panel")].filter((p) => !p.hidden).map((p) => p.id), expanded: [...document.querySelectorAll(".rw-tile")].map((t) => t.getAttribute("aria-expanded")), heights: [...new Set([...document.querySelectorAll(".rw-tile")].map((t) => Math.round(t.getBoundingClientRect().height)))] })`);
    let tiles = await state();
    check("4 gleich hohe Kacheln, alle Details geschlossen", tiles.open.length === 0 && tiles.heights.length === 1, JSON.stringify(tiles));
    await page.eval(`document.querySelectorAll(".rw-tile")[0].click()`);
    await page.until(`document.querySelectorAll(".rw-tiles__panel:not([hidden])").length === 1`, 3000);
    tiles = await state();
    const panelId = await page.eval(`document.querySelectorAll(".rw-tile")[0].getAttribute("aria-controls")`);
    check("  Klick öffnet nur die Details dieser Kachel", tiles.open.length === 1 && tiles.open[0] === panelId && tiles.expanded[0] === "true", JSON.stringify(tiles));
    await page.eval(`document.querySelectorAll(".rw-tile")[2].click()`);
    await page.until(`document.querySelectorAll(".rw-tile")[2].getAttribute("aria-expanded") === "true"`, 3000);
    tiles = await state();
    check("  andere Kachel wechselt die Details", tiles.open.length === 1 && tiles.expanded[0] === "false" && tiles.expanded[2] === "true", JSON.stringify(tiles));
    await page.eval(`document.querySelectorAll(".rw-tile")[2].click()`);
    await page.until(`document.querySelectorAll(".rw-tiles__panel:not([hidden])").length === 0`, 3000);
    check("  zweiter Klick schließt", (await state()).open.length === 0);
  }

  console.log("\nRechnungen: Seitenmenü mit „Zu erledigen“ als Standardansicht");
  {
    await page.open(`${BASE}/dashboard/rechnungen`);
    const view = await page.eval(`({ active: document.querySelector('.side-menu--wide [aria-current="page"]')?.textContent ?? "", list: !!document.querySelector("#rechnungsliste .data-table, #rechnungsliste .dash-state") })`);
    check("Seitenmenü: „Zu erledigen“ aktiv, Liste vorhanden", view.active.startsWith("Zu erledigen") && view.list, JSON.stringify(view));
    await page.eval(`[...document.querySelectorAll('.side-menu--wide a')].find((a) => a.textContent.startsWith("Überfällig")).click()`);
    const switched = await page.until(`location.search.includes("status=ueberfaellig") && document.querySelector('.side-menu--wide [aria-current="page"]')?.textContent.startsWith("Überfällig")`, 5000);
    check("  Menüpunkt „Überfällig“ wechselt die Liste", switched);
  }

  console.log("\nSLA-Vertrag: Abgleich mit dem Vertragsbestand in der Anfrage (task-13-9)");
  {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const contractNote = async (number) => {
      const { data } = await admin.from("requests").select("id").eq("is_demo", true).eq("sla_contract_number", number).limit(1).maybeSingle();
      if (!data) return null;
      await page.open(`${BASE}/dashboard/anfragen/${data.id}`);
      return page.eval(`(() => { const e = document.querySelector(".contract-note"); return e ? { state: e.dataset.state, text: e.textContent } : null; })()`);
    };
    const valid = await contractNote("SLA-2021-801");
    check("Gültiger Vertrag mit 24/7 erkannt", valid?.state === "valid_24_7" && valid.text.includes("24/7"), JSON.stringify(valid));
    const expired = await contractNote("SLA-2020-433");
    check("  abgelaufener Vertrag mit Datum", expired?.state === "expired" && expired.text.includes("30.06.2026"), JSON.stringify(expired));
  }

  console.log("\nZahlungserinnerungen: Mahnstufe in Liste und Anfrage, Stufen in den Einstellungen (task-10-2)");
  {
    await page.open(`${BASE}/dashboard/rechnungen?status=ueberfaellig`);
    const list = await page.eval(`(() => { const heads = [...document.querySelectorAll("#rechnungsliste th")].map((th) => th.textContent.trim()); const i = heads.indexOf("Mahnstufe"); return { i, cells: i < 0 ? [] : [...document.querySelectorAll("#rechnungsliste tbody tr")].map((tr) => tr.children[i]?.textContent.trim() ?? "") }; })()`);
    check("Spalte „Mahnstufe“ mit Stufen und nächster Erinnerung", list.i >= 0 && list.cells.some((c) => /Mahnung|Erinnerung/.test(c)) && list.cells.some((c) => c.includes("→")), JSON.stringify(list.cells.slice(0, 4)));
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    const { data: reminder } = await admin.from("invoice_reminders").select("invoices(request_id)").eq("stage", 2).limit(1).maybeSingle();
    const requestId = reminder && (Array.isArray(reminder.invoices) ? reminder.invoices[0] : reminder.invoices)?.request_id;
    if (!requestId) check("Demo-Rechnung mit Mahnungen vorhanden", false);
    else {
      await page.open(`${BASE}/dashboard/anfragen/${requestId}#rechnung`);
      const view = await page.eval(`({ items: document.querySelectorAll(".reminders__list li").length, stage: [...document.querySelectorAll("dt")].find((dt) => dt.textContent === "Mahnstufe")?.nextElementSibling?.textContent ?? "" })`);
      check("Anfrageseite zeigt Verlauf und Mahnstufe", view.items >= 2 && /Mahnung/.test(view.stage), JSON.stringify(view));
    }
    await page.open(`${BASE}/dashboard/verwaltung/einstellungen`);
    const fields = await page.eval(`["reminder_stage1_days", "reminder_stage2_days", "reminder_stage3_days"].map((name) => document.querySelector(\`[name="\${name}"]\`)?.value ?? null)`);
    check("Einstellungen zeigen drei Erinnerungsstufen", fields.every((v) => v !== null), JSON.stringify(fields));
    await page.eval(`(() => { const input = document.querySelector('[name="reminder_stage1_days"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, "0"); input.dispatchEvent(new Event("input", { bubbles: true })); input.form.requestSubmit(); })()`);
    check("  ungültiger Abstand wird abgewiesen, nichts gespeichert", await page.until(`document.querySelector('[name="reminder_stage1_days"]')?.getAttribute("aria-invalid") === "true"`, 10000));
  }

  console.log("\nEingaben bleiben bei fehlgeschlagenem Speichern erhalten");
  await page.send("Network.clearBrowserCookies");
  await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.open(`${BASE}/dashboard/bausteine`);
  const fill = (values) => page.eval(`(() => {
    const values = ${JSON.stringify(values)};
    for (const [name, value] of Object.entries(values)) {
      const element = document.querySelector('form.save-form [name="' + name + '"]');
      if (element.type === "checkbox") element.checked = value;
      else element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  })()`);
  const read = () => page.eval(`(() => {
    const form = document.querySelector("form.save-form");
    const get = (name) => { const element = form.querySelector('[name="' + name + '"]'); return element.type === "checkbox" ? element.checked : element.value; };
    return {
      company: get("company"), hours: get("hours"), priority: get("priority"), note: get("note"), conflict: get("simulate_conflict"),
      invalid: [...form.querySelectorAll("[aria-invalid='true']")].map((element) => element.name),
      status: form.querySelector(".save-status")?.textContent ?? "",
      focused: document.activeElement?.name ?? null,
    };
  })()`);
  const submit = async (expectedClass) => {
    await page.eval(`document.querySelector("form.save-form").requestSubmit()`);
    return page.until(`!!document.querySelector("form.save-form .save-status.${expectedClass}") && !document.querySelector("form.save-form button[type=submit]").disabled`);
  };

  await fill({ company: "", hours: "abc", priority: "high", note: "Notiz bleibt stehen" });
  const unsaved = await read();
  check("Hinweis auf ungespeicherte Änderungen", unsaved.status.includes("Ungespeicherte Änderungen"), unsaved.status);
  check("Validierungsfehler wird angezeigt", await submit("save-status--error"));
  let state = await read();
  check("  Eingaben erhalten (Stunden, Priorität, Notiz)", state.hours === "abc" && state.priority === "high" && state.note === "Notiz bleibt stehen", JSON.stringify(state));
  check("  fehlerhafte Felder markiert, Fokus auf erstem Fehler", state.invalid.join(",") === "company,hours" && state.focused === "company", JSON.stringify(state));

  await fill({ company: "Muster Pumpentechnik GmbH", hours: "2,5", simulate_conflict: true });
  check("Versionskonflikt wird angezeigt", await submit("save-status--error"));
  state = await read();
  check("  Eingaben nach Konflikt erhalten", state.company === "Muster Pumpentechnik GmbH" && state.hours === "2,5" && state.priority === "high" && state.note === "Notiz bleibt stehen" && state.conflict === true, JSON.stringify(state));
  check("  Konfliktmeldung verständlich", /inzwischen .* geändert/.test(state.status), state.status);

  await fill({ simulate_conflict: false });
  check("Erfolgreiches Speichern zeigt Zeitpunkt", await submit("save-status--success"));
  state = await read();
  check("  Status „Gespeichert … HH:MM“, keine Fehlermarkierung", /Gespeichert .*\d{2}:\d{2}/.test(state.status) && state.invalid.length === 0, JSON.stringify(state));
  console.log("\nPrüfaktionen auf der Anfrageseite");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  cleanupClient = admin;
  const runId = Date.now().toString(36);
  const dispoEmail = `ui-dispo-${runId}@example.com`;
  const { data: created } = await admin.auth.admin.createUser({ email: dispoEmail, password, email_confirm: true });
  const dispoId = created.user.id;
  testAccounts.push(dispoId);
  await admin.from("profiles").insert({ id: dispoId, display_name: `UI-Test Dispatcher ${runId}`, role: "dispatcher" });
  const newRequest = async (key, overrides = {}) => {
    const { data, error } = await admin.from("requests").insert({
      source_event_key: `ui-${key}-${runId}`, request_number: "x", source: "demo_seed", is_demo: true,
      company_name: `UI-Test ${key}`, contact_name: "Erika Muster", business_email: `ui-${key}@example.com`, phone_number: "+49 211 1",
      street_house_number: "Werkstr. 1", postal_code: "40210", city: "Düsseldorf", equipment_kind: "pump", service_kind: "inspection",
      requested_visit_date: "2030-03-01", description: "UI-Test", customer_urgency: "zeitnah", safety_risk: "none_known",
      raw_payload: { test: runId }, dispatcher_id: dispoId, intake_status: "needs_review", human_review_required: true,
      ...overrides,
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  };
  const request = await newRequest("review");

  // Hanging Gmail dispatch (task-12-9): a receipt of a real request waiting for 15 minutes. The send lease is created
  // in the same statement, so the running n8n does not claim and really send it during the test.
  {
    console.log("\nHinweis bei hängendem E-Mail-Versand");
    const container = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_A.Sadkovojs_Project";
    const psql = (sql) => execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], { input: sql }).toString().trim();
    const banner = () => page.eval(`(() => { const el = document.querySelector(".send-backlog-alert"); return el ? { text: el.textContent, scroll: document.documentElement.scrollWidth, width: innerWidth } : null; })()`);
    const real = await newRequest("backlog", { is_demo: false, source: "website_form", dispatcher_id: null });
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
    await page.open(`${BASE}/dashboard/erstbearbeitung`);
    const before = await banner();
    const messageId = psql(`with m as (insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, approved_at)
      values ('${real.id}', 'outgoing', 'receipt', 'queued', 'ui-backlog@example.com', 'UI-Test', 'UI-Test', now() - interval '15 minutes') returning id),
      l as (insert into private.integration_send_leases (message_id, lease_until, next_attempt_at) select id, now() + interval '1 hour', now() + interval '1 hour' from m)
      select id from m;`);
    try {
      await page.open(`${BASE}/dashboard/erstbearbeitung`);
      const dispo = await banner();
      check("Dispatcher: Hinweis mit Wartezeit und Bitte an die Verwaltung", before === null && !!dispo && /warte(t|n) seit 1\d min/.test(dispo.text) && dispo.text.includes("Verwaltung informieren"), JSON.stringify({ before, dispo }));
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
      for (const width of [1440, 768, 390]) {
        await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
        await page.open(`${BASE}/dashboard/kunden`);
        const shown = await banner();
        check(`  Admin: Hinweis nennt den Gmail-Zugang in n8n, kein horizontales Scrollen @${width}`, !!shown && shown.text.includes("in n8n prüfen") && shown.scroll <= shown.width, JSON.stringify(shown));
        if (SHOTS) {
          const shot = await page.send("Page.captureScreenshot", { format: "png" });
          await writeFile(path.join(SHOTS, `versand-haengt-${width}.png`), Buffer.from(shot.data, "base64"));
        }
      }
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies("technik1.demo@example.com") });
      await page.open(`${BASE}/dashboard`);
      check("  Techniker: kein Hinweis", (await banner()) === null);
    } finally {
      // The request is not a demo request, so it is removed again instead of staying in the local data
      psql(`delete from private.integration_send_leases where message_id = '${messageId}'; delete from public.messages where id = '${messageId}';
        delete from public.requests where id = '${real.id}';`);
    }
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
    await page.open(`${BASE}/dashboard/kunden`);
    check("  Nach dem Versand kein Hinweis mehr", (await banner()) === null);
  }
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  const { data: analysis, error: analysisError } = await admin.from("automation_runs").insert({ request_id: request.id, operation_key: `ui:${runId}`, step: "intake_analysis", status: "succeeded", decision: "human_review", started_at: startedAt, finished_at: new Date(Date.now() - 60_000).toISOString() }).select().single();
  if (analysisError) throw new Error(`Automatisierungslauf: ${analysisError.message}`);
  const dbRequest = async (id = request.id) => (await admin.from("requests").select("*").eq("id", id).single()).data;
  const waitFor = async (condition, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await condition()) return true; await sleep(150); }
    return false;
  };
  // Possible existing customer (task-14-2): suggestion card, "Zuordnen", "Neuen Kunden anlegen", flags in list and queue.
  // Demo requests and a demo customer, so nothing reaches the live master data.
  {
    console.log("\nMöglicher Bestandskunde auf der Anfrageseite (task-14-2)");
    const { data: suggested } = await admin.from("customers").select("id, customer_number, company_name").eq("is_demo", true).eq("is_active", true).order("customer_number").limit(1).single();
    const linkReq = await newRequest("kunde-zuordnen", { company_name: `UI-Kundenvorschlag ${runId}` });
    const createReq = await newRequest("kunde-neu", { company_name: `UI-Neukunde ${runId}` });
    for (const req of [linkReq, createReq]) {
      const { error } = await admin.from("request_customer_suggestions").insert({ request_id: req.id, customer_id: suggested.id, reason: "gleiche_firma" });
      if (error) throw new Error(`Vorschlag: ${error.message}`);
    }
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.open(`${BASE}/dashboard/anfragen?ansicht=alle&suche=${encodeURIComponent(`UI-Kundenvorschlag ${runId}`)}`);
    check("Anfragenliste: Kennzeichen „Kunde prüfen“", await page.eval(`!!document.querySelector(".rw-flag--customer")`));
    await page.open(`${BASE}/dashboard/erstbearbeitung?tab=pruefung`);
    check("  Erstbearbeitung: Hinweis „Kunde prüfen“", await page.eval(`[...document.querySelectorAll(".hint")].some((h) => h.textContent.startsWith("Kunde prüfen"))`));
    for (const width of [1440, 768, 390]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
      await page.open(`${BASE}/dashboard/anfragen/${linkReq.id}`);
      const card = await page.eval(`(() => { const el = document.querySelector(".customer-suggest"); return el ? { text: el.textContent, item: el.querySelector("[data-suggestion]")?.dataset.suggestion, buttons: [...el.querySelectorAll("button")].map((b) => b.textContent), scroll: document.documentElement.scrollWidth, width: innerWidth } : null; })()`);
      check(`  Karte mit Kunde, Grund, Zuordnen und Neuen Kunden anlegen, kein horizontales Scrollen @${width}`, !!card && card.item === suggested.customer_number && card.text.includes("Gleiche Firma an anderem Standort")
        && card.buttons.includes("Zuordnen") && card.buttons.includes("Neuen Kunden anlegen") && card.scroll <= card.width, JSON.stringify(card).slice(0, 300));
      if (SHOTS) {
        // Sticky side column: scroll instantly, then cut the card out of the visible area
        const clip = await page.eval(`(() => { document.documentElement.style.scrollBehavior = "auto"; const el = document.querySelector(".customer-suggest"); el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left - 16), y: Math.max(0, r.top + scrollY - 16), width: Math.min(innerWidth, r.width + 32), height: r.height + 32, scale: 1 }; })()`);
        const shot = await page.send("Page.captureScreenshot", { format: "png", clip });
        await writeFile(path.join(SHOTS, `kundenvorschlag-${width}.png`), Buffer.from(shot.data, "base64"));
      }
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.eval(`document.querySelector(".customer-suggest__action button").click()`);
    const linked = await waitFor(async () => (await admin.from("requests").select("customer_id").eq("id", linkReq.id).single()).data?.customer_id === suggested.id);
    const { count: leftLink } = await admin.from("request_customer_suggestions").select("request_id", { count: "exact", head: true }).eq("request_id", linkReq.id);
    check("  „Zuordnen“ verknüpft die Anfrage, Vorschläge erledigt", linked && leftLink === 0);
    check("  Seite zeigt danach „Verknüpft mit“ statt der Karte", await waitFor(async () => page.eval(`!document.querySelector(".customer-suggest") && document.querySelector(".request-customer").textContent.includes("Verknüpft mit")`)));

    await page.open(`${BASE}/dashboard/anfragen/${createReq.id}`);
    await page.eval(`document.querySelector(".customer-suggest__create button").click()`);
    const created = await waitFor(async () => !!(await admin.from("requests").select("customer_id").eq("id", createReq.id).single()).data?.customer_id);
    const { data: newCustomer } = await admin.from("requests").select("customers!requests_customer_id_fkey(company_name, is_demo)").eq("id", createReq.id).single();
    check("  „Neuen Kunden anlegen“ legt den Kunden aus der Anfrage an (Demo) und verknüpft", created && newCustomer?.customers?.company_name === `UI-Neukunde ${runId}` && newCustomer?.customers?.is_demo === true, JSON.stringify(newCustomer));
    // Origin of the customer (task-14-4)
    const { data: origin } = await admin.from("requests").select("request_number, customer_id").eq("id", createReq.id).single();
    await page.open(`${BASE}/dashboard/kunden/${origin.customer_id}`);
    check("  Kundenseite: Herkunft „Automatisch aus RIS-…“ mit Link zur Anfrage", await page.eval(`(() => { const dd = document.querySelector("[data-origin]"); return !!dd && dd.textContent.includes(${JSON.stringify(origin.request_number)}) && !!dd.querySelector('a[href="/dashboard/anfragen/${createReq.id}"]'); })()`));
    // Customer number and main address in the master data (task-15-1)
    const { data: master } = await admin.from("customers").select("customer_number, customer_sites(street_house_number, postal_code, city)").eq("id", origin.customer_id).single();
    for (const width of [390, 768, 1440]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
      await page.open(`${BASE}/dashboard/kunden/${origin.customer_id}`);
      const facts = await page.eval(`(() => { const rows = [...document.querySelectorAll("#stammdaten-title ~ .facts > div")]; const number = document.querySelector("[data-customer-number]"); const address = document.querySelector("[data-main-address]");
        return { first: rows[0]?.querySelector("dt")?.textContent, number: number?.querySelector(".copy-value__text")?.textContent, button: !!number?.querySelector("button"), address: address?.textContent ?? "", scroll: document.documentElement.scrollWidth, width: innerWidth }; })()`);
      const site = master.customer_sites[0];
      check(`  Stammdaten: Kundennummer als erste Zeile mit Kopieren, Anschrift mit PLZ, kein horizontales Scrollen @${width}`, facts.first === "Kundennummer" && facts.number === master.customer_number && facts.button
        && facts.address.includes(site.street_house_number) && facts.address.includes(site.postal_code) && facts.address.includes(site.city) && facts.scroll <= facts.width, JSON.stringify(facts));
      if (SHOTS) {
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(SHOTS, `kunde-stammdaten-${width}.png`), Buffer.from(shot.data, "base64"));
      }
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    // Headless Chrome only grants the clipboard to a focused page with permission
    await page.send("Browser.grantPermissions", { origin: new URL(BASE).origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.eval(`document.querySelector("[data-customer-number] button").click()`);
    const copied = await waitFor(async () => page.eval(`document.querySelector("[data-customer-number] [role=status]").textContent === "Kundennummer kopiert"`), 3000);
    const clipboard = await page.eval(`navigator.clipboard.readText().catch((e) => String(e))`);
    check("  „Kopieren“ legt die Kundennummer in die Zwischenablage", copied && clipboard === master.customer_number, JSON.stringify({ copied, clipboard }));

    const plainReq = await newRequest("kunde-ohne-vorschlag");
    await page.open(`${BASE}/dashboard/anfragen/${plainReq.id}`);
    check("  Ohne Vorschlag: Schaltfläche „Neuen Kunden aus der Anfrage anlegen“", await page.eval(`[...document.querySelectorAll(".request-customer__create button")].some((b) => b.textContent === "Neuen Kunden aus der Anfrage anlegen")`));
  }

  const actionForm = (summary) => `[...document.querySelectorAll("details.action")].find((d) => d.querySelector("summary").textContent.trim() === ${JSON.stringify(summary)})`;
  const fillIn = (formExpr, values) => page.eval(`(() => {
    const host = ${formExpr};
    if (host.tagName === "DETAILS") host.open = true;
    const form = host.tagName === "FORM" ? host : host.querySelector("form");
    for (const [name, value] of Object.entries(${JSON.stringify(values)})) {
      const element = form.querySelector('[name="' + name + '"]');
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    form.requestSubmit();
  })()`);
  const formStatus = (formExpr) => page.eval(`(() => { const host = ${formExpr}; const form = host && (host.tagName === "FORM" ? host : host.querySelector("form")); return form ? { status: form.querySelector(".save-status")?.className + " " + form.querySelector(".save-status")?.textContent, values: Object.fromEntries([...form.querySelectorAll("input:not([type=hidden]), select, textarea")].map((e) => [e.name, e.value])), pending: form.querySelector("button[type=submit]").disabled } : null; })()`);
  const settled = async (formExpr, cls) => (await waitFor(async () => { const state = await formStatus(formExpr); return Boolean(state && !state.pending && state.status.includes(cls)); })) && formStatus(formExpr);

  await page.send("Network.clearBrowserCookies");
  await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const requestUrl = `${BASE}/dashboard/anfragen/${request.id}`;
  await page.open(requestUrl);
  check("Aktionen für zugewiesenen Dispatcher sichtbar", await page.eval(`!!document.getElementById("aktionen")`));

  // Correction: missing reason keeps the chosen priority, then success marks the automation run
  await fillIn(actionForm("Analyse korrigieren"), { priority: "high", reason: "" });
  state = await settled(actionForm("Analyse korrigieren"), "save-status--error");
  check("Korrektur ohne Grund: Fehlermeldung, Auswahl bleibt erhalten", Boolean(state) && state.values.priority === "high", JSON.stringify(state));
  await fillIn(actionForm("Analyse korrigieren"), { priority: "high", reason: "Produktion steht laut Telefonat" });
  const corrected = await waitFor(async () => (await dbRequest()).priority === "high");
  const run = (await admin.from("automation_runs").select("corrected_at, correction_reason").eq("id", analysis.id).single()).data;
  const correctionEvent = (await admin.from("request_events").select("event_type").eq("request_id", request.id).eq("event_type", "automatic_result_corrected")).data;
  check("Korrektur über correct_analysis: Priorität, Lauf markiert, Ereignis", corrected && Boolean(run.corrected_at) && correctionEvent.length === 1, JSON.stringify(run));

  // Draft → edit → queue (two saves in a row use the refreshed version)
  await page.open(requestUrl);
  await fillIn(actionForm("E-Mail an Kunden vorbereiten"), { subject: "Rückfrage UI-Test", body_text: "Bitte senden Sie uns das Typenschild." });
  const drafted = await waitFor(async () => (await admin.from("messages").select("id").eq("request_id", request.id).eq("status", "draft")).data.length === 1);
  check("E-Mail vorbereiten erzeugt nur einen Entwurf", drafted);
  await page.until(`!!document.querySelector(".draft-actions")`);
  const draftForm = (index) => `document.querySelectorAll(".draft-actions form")[${index}]`;
  await fillIn(draftForm(0), { subject: "Rückfrage UI-Test (geändert)" });
  check("Entwurf bearbeitet", await waitFor(async () => (await admin.from("messages").select("subject").eq("request_id", request.id).single()).data.subject === "Rückfrage UI-Test (geändert)"));
  await sleep(500);
  await page.eval(`${draftForm(1)}.requestSubmit()`);
  const queued = await waitFor(async () => (await admin.from("messages").select("status").eq("request_id", request.id).single()).data.status === "queued");
  const message = (await admin.from("messages").select("status, sent_at").eq("request_id", request.id).single()).data;
  check("In Warteschlange gestellt, kein Versand (sent_at leer)", queued && message.sent_at === null, JSON.stringify(message));
  await page.open(requestUrl);
  const badges = await page.eval(`[...document.querySelectorAll("#korrespondenz .message .status-badge")].map((badge) => badge.textContent.trim())`);
  check("Oberfläche meldet keinen Versand (Status „In Warteschlange, nicht versendet“)", JSON.stringify(badges) === JSON.stringify(["In Warteschlange, nicht versendet"]), badges.join(","));

  // Release: complete_intake with priority → planning queue
  await fillIn(actionForm("Prüfen und freigeben"), { priority: "high", note: "Geprüft im UI-Test" });
  const released = await waitFor(async () => (await dbRequest()).intake_status === "processed");
  const after = await dbRequest();
  const queueRow = (await admin.from("dispatcher_queue").select("queue").eq("id", request.id).single()).data;
  check("Freigabe: processed, Modus human_review, Warteschlange Planung", released && after.intake_mode === "human_review" && queueRow.queue === "planning", `${after.intake_status} ${after.intake_mode} ${queueRow.queue}`);

  // Version conflict on reject keeps the reason; after reload the rejection succeeds
  await page.open(requestUrl);
  await admin.from("requests").update({ site_label: "Parallel geändert" }).eq("id", request.id);
  await fillIn(actionForm("Anfrage ablehnen"), { reason: "Außerhalb des Servicegebiets" });
  state = await settled(actionForm("Anfrage ablehnen"), "save-status--error");
  check("Versionskonflikt: verständliche Meldung, Grund bleibt erhalten", Boolean(state) && state.values.reason === "Außerhalb des Servicegebiets" && /inzwischen .* geändert/.test(state.status), JSON.stringify(state));
  check("  keine Änderung in der Datenbank", (await dbRequest()).intake_status === "processed");
  await page.open(requestUrl);
  await fillIn(actionForm("Anfrage ablehnen"), { reason: "Außerhalb des Servicegebiets" });
  const rejected = await waitFor(async () => (await dbRequest()).intake_status === "rejected");
  check("Ablehnung mit Grund über reject_request", rejected && (await dbRequest()).rejection_reason === "Außerhalb des Servicegebiets");
  await page.open(requestUrl);
  check("Nach Ablehnung keine Prüfaktionen mehr", await page.eval(`!document.getElementById("aktionen")`));
  // Inbox (task-10-5) as the temporary dispatcher: list, badge, prefilled new-request form, assignment via link_message
  console.log("\nTerminwunsch vom Telefonassistenten: Hinweis, bestätigen, ablehnen (task-13-3)");
  {
    // A weekday about five weeks ahead, far from demo visits; two holds of one technician
    const day = new Date(Date.now() + 35 * 86400000);
    while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
    const dayKey = day.toISOString().slice(0, 10);
    const at = (hhmm) => new Date(`${dayKey}T${hhmm}:00+01:00`).toISOString().replace(/\.000Z$/, "Z");
    const { data: tech } = await admin.from("profiles").select("id").eq("role", "technician").eq("is_active", true).order("id").limit(1).single();
    const processed = { intake_status: "processed", intake_completed_at: new Date().toISOString(), intake_mode: "manual", manual_minutes_baseline: 15, human_review_required: false, postal_code: "68159", city: "Mannheim", service_kind: "diagnosis_repair" };
    const holdFor = async (key, start, end) => {
      const req = await newRequest(key, processed);
      const { data, error } = await admin.from("visit_holds").insert({ request_id: req.id, technician_id: tech.id, starts_at: at(start), ends_at: at(end), expires_at: new Date(Date.now() + 2 * 86400000).toISOString(), conversation_id: `ui-${key}-${runId}` }).select().single();
      if (error) throw new Error(`Vormerkung: ${error.message}`);
      return { req, hold: data };
    };
    const confirmCase = await holdFor("hold-ok", "13:00", "15:00");
    const rejectCase = await holdFor("hold-no", "08:00", "10:00");
    try {
      await page.open(`${BASE}/dashboard/anfragen?suche=${encodeURIComponent(confirmCase.req.request_number)}`);
      check("Anfragenliste: Kennzeichen „Terminwunsch“", await page.eval(`[...document.querySelectorAll(".rw-flag--hold")].some((e) => e.textContent === "Terminwunsch")`));
      await page.open(`${BASE}/dashboard/erstbearbeitung?tab=planung`);
      check("  Erstbearbeitung: Hinweis „Terminwunsch (Telefon)“", await page.eval(`[...document.querySelectorAll(".hint")].some((e) => e.textContent.startsWith("Terminwunsch (Telefon)"))`));
      await page.open(`${BASE}/dashboard/planung?woche=${dayKey}`);
      check("  Plantafel zeigt die Vormerkung (schraffiert, nicht blockierend)", await page.eval(`[...document.querySelectorAll(".plan3__blk--hold")].some((e) => (e.getAttribute("title") ?? "").includes(${JSON.stringify(confirmCase.req.request_number)}))`));
      await page.open(`${BASE}/dashboard/anfragen/${confirmCase.req.id}`);
      const card = await page.eval(`(() => { const c = document.getElementById("terminwunsch"); return c ? { title: c.querySelector("h2")?.textContent ?? "", text: c.textContent } : null; })()`);
      check("  Anfrage: Block „Terminwunsch (Telefon)“ mit Zeitfenster", !!card && /\d{2}:\d{2}/.test(card.title) && card.text.includes("Termin bestätigen"), JSON.stringify(card));
      await page.eval(`document.querySelector("#terminwunsch form.save-form").requestSubmit()`);
      const confirmed = await waitFor(async () => (await admin.from("visit_holds").select("status").eq("id", confirmCase.hold.id).single()).data?.status === "confirmed");
      const { data: planned } = await admin.from("visits").select("scheduled_start, technician_id, status").eq("request_id", confirmCase.req.id);
      const { data: mails } = await admin.from("messages").select("subject, status, approved_by, to_address").eq("request_id", confirmCase.req.id).eq("kind", "other");
      check("  Bestätigen: Einsatz im Fenster geplant, Bestätigung an den Kunden in der Warteschlange",
        confirmed && planned?.length === 1 && Date.parse(planned[0].scheduled_start) === Date.parse(at("13:00")) && mails?.length === 1 && mails[0].approved_by === dispoId && mails[0].subject.startsWith("Terminbestätigung"),
        JSON.stringify({ planned, mails }));
      await page.open(`${BASE}/dashboard/anfragen/${confirmCase.req.id}`);
      check("  danach kein offener Terminwunsch mehr", await page.eval(`!document.getElementById("terminwunsch")`));
      await page.open(`${BASE}/dashboard/anfragen/${rejectCase.req.id}`);
      await fillIn(`document.querySelector("#terminwunsch details.action")`, { reason: "Techniker auf Schulung", alternative: "Donnerstag ab 10 Uhr" });
      const rejected = await waitFor(async () => (await admin.from("visit_holds").select("status").eq("id", rejectCase.hold.id).single()).data?.status === "rejected");
      const { data: rejectMail } = await admin.from("messages").select("body_text").eq("request_id", rejectCase.req.id).eq("kind", "other").maybeSingle();
      check("  Ablehnen mit Grund und Gegenvorschlag, E-Mail an den Kunden", rejected && !!rejectMail?.body_text.includes("Techniker auf Schulung") && rejectMail.body_text.includes("Donnerstag ab 10 Uhr"), JSON.stringify(rejectMail));
    } finally {
      // Demo requests: the seed removes them; the planned test visit is cancelled so it never blocks the calendar
      await admin.from("visits").update({ status: "cancelled", cancellation_reason: "UI-Test" }).eq("request_id", confirmCase.req.id).eq("status", "scheduled");
      await admin.from("visit_holds").update({ status: "expired" }).in("id", [confirmCase.hold.id, rejectCase.hold.id]).eq("status", "open");
    }
  }

  console.log("\nRückrufbitte an den Techniker: Banner, Quittung, Eskalation (task-13-4)");
  {
    // Own test technician with an overdue visit, so demo banners do not interfere
    const techEmail = `ui-callback-tech-${runId}@example.com`;
    const { data: techUser } = await admin.auth.admin.createUser({ email: techEmail, password, email_confirm: true });
    const techId = techUser.user.id;
    testAccounts.push(techId);
    await admin.from("profiles").insert({ id: techId, display_name: `UI-Test Rückruf ${runId}`, role: "technician" });
    const req = await newRequest("callback", { intake_status: "processed", intake_completed_at: new Date().toISOString(), intake_mode: "manual", manual_minutes_baseline: 15, human_review_required: false, technician_id: techId, work_status: "scheduled", phone_number: "+49 621 4455667" });
    const { error: visitError } = await admin.from("visits").insert({ request_id: req.id, technician_id: techId, scheduled_start: new Date(Date.now() - 20 * 60000).toISOString(), scheduled_end: new Date(Date.now() + 100 * 60000).toISOString(), created_by: dispoId });
    if (visitError) throw new Error(`Einsatz: ${visitError.message}`);
    const ask = async (n) => (await admin.rpc("agent_request_callback", { call_id: `ui-callback-${runId}-${n}`, anfrage_id: req.id, rueckrufnummer: "0621 4455667" })).data;
    const banner = () => page.eval(`(() => { const b = document.querySelector(".callback-alert[data-callback-id]"); return b ? { text: b.textContent, tel: b.querySelector("a[href^='tel:']")?.getAttribute("href"), title: document.title, scroll: document.documentElement.scrollWidth, width: window.innerWidth } : null; })()`);
    const clickAck = () => page.eval(`[...document.querySelectorAll(".callback-alert button")].find((b) => b.textContent.includes("Kunde angerufen"))?.click()`);
    try {
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies(techEmail) });
      await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await page.open(`${BASE}/dashboard/heute`);
      check("Mein Tag ohne offene Rückrufbitte: kein Banner", (await banner()) === null);
      const first = await ask(1);
      check("  Werkzeug legt die Rückrufbitte an", first?.ok === true && first.bereits_offen === false, JSON.stringify(first));
      const appeared = await waitFor(async () => (await banner()) !== null, 30000);
      const shown = await banner();
      check("  Banner erscheint ohne Neuladen (Abfrage alle 20 s)", appeared);
      check("  Firma, Standort, Rückrufnummer als tel:-Link, Zähler im Tab-Titel, kein horizontales Scrollen bei 390 px",
        !!shown && shown.text.includes(req.company_name) && shown.text.includes("Werkstr. 1, 40210 Düsseldorf") && shown.tel === "tel:06214455667" && shown.title.startsWith("(1) ") && shown.scroll <= shown.width,
        JSON.stringify(shown));
      if (process.env.UI_SCREENSHOTS) {
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(SHOTS, "rueckrufbitte-390.png"), Buffer.from(shot.data, "base64"));
      }
      await clickAck();
      const acknowledged = await waitFor(async () => (await admin.from("callback_requests").select("status, closed_by").eq("request_id", req.id).eq("closed_reason", "acknowledged").maybeSingle()).data?.closed_by === techId);
      check("  „Kunde angerufen“ quittiert, Banner verschwindet", acknowledged && await waitFor(async () => (await banner()) === null));

      // No acknowledgement within 15 minutes: escalated to the dispatcher of the request
      const second = await ask(2);
      await admin.from("callback_requests").update({ created_at: new Date(Date.now() - 16 * 60000).toISOString() }).eq("id", second.rueckrufbitte_id);
      await admin.rpc("escalate_callbacks");
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.open(`${BASE}/dashboard/erstbearbeitung`);
      const urgent = await banner();
      if (process.env.UI_SCREENSHOTS) {
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(SHOTS, "rueckrufbitte-dispatcher-1440.png"), Buffer.from(shot.data, "base64"));
      }
      check("Dispatcher: dringender Banner nach Eskalation mit Techniker", !!urgent && urgent.text.includes("Dringend") && urgent.text.includes(`UI-Test Rückruf ${runId}`), JSON.stringify(urgent));
      await clickAck();
      const closed = await waitFor(async () => (await admin.from("callback_requests").select("status, closed_by").eq("id", second.rueckrufbitte_id).single()).data?.closed_by === dispoId);
      check("  Dispatcher quittiert die Eskalation", closed);

      // Urgent call of the phone assistant (task-13-6): banner for dispatchers until "Rückruf erledigt"
      const { data: call, error: callError } = await admin.from("phone_calls").insert({ conversation_id: `ui-call-${runId}`, callback_needed: true, callback_urgent: true,
        callback_reason: `UI-Test Gasgeruch ${runId}`, callback_number: "0621 778899", analysis: { firma: `UI-Test Anrufer ${runId}` } }).select().single();
      if (callError) throw new Error(`Anruf: ${callError.message}`);
      await page.open(`${BASE}/dashboard/anfragen`);
      const callBanner = await page.eval(`(() => { const b = document.querySelector('.callback-alert[data-call-id="${call.id}"]'); return b ? { text: b.textContent, tel: b.querySelector("a[href^='tel:']")?.getAttribute("href") } : null; })()`);
      check("Dispatcher: dringender Anruf als Banner mit Grund, Firma und Rückrufnummer", !!callBanner && callBanner.text.includes(`UI-Test Gasgeruch ${runId}`)
        && callBanner.text.includes(`UI-Test Anrufer ${runId}`) && callBanner.tel === "tel:0621778899", JSON.stringify(callBanner));
      await page.eval(`[...document.querySelectorAll('.callback-alert[data-call-id="${call.id}"] button')].find((b) => b.textContent.includes("Rückruf erledigt"))?.click()`);
      check("  „Rückruf erledigt“ quittiert, Banner verschwindet", await waitFor(async () => (await admin.from("phone_calls").select("callback_done_by").eq("id", call.id).single()).data?.callback_done_by === dispoId)
        && await waitFor(async () => !(await page.eval(`!!document.querySelector('.callback-alert[data-call-id="${call.id}"]')`))));
      await admin.from("phone_calls").delete().eq("id", call.id);
    } finally {
      await admin.from("visits").update({ status: "cancelled", cancellation_reason: "UI-Test" }).eq("request_id", req.id).eq("status", "scheduled");
      await admin.rpc("escalate_callbacks");
      // Call rows the tool created for this test (task-13-7: otherwise listed under Anrufe)
      await admin.from("phone_calls").delete().like("conversation_id", `ui-callback-${runId}-%`);
    }
  }

  console.log("\nKundenstamm: Liste, Anlegen, Bearbeiten, Standort, Verknüpfung in der Anfrage (task-13-10)");
  {
    const company = `UI-Test Kunde ${runId}`;
    const req = await newRequest("customer", { company_name: "Falsch verstanden GmbH", business_email: `falsch-${runId}@example.com` });
    const noScroll = () => page.eval(`document.documentElement.scrollWidth <= window.innerWidth`);
    const shot = async (name) => {
      if (!SHOTS) return;
      const image = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      await writeFile(path.join(SHOTS, name), Buffer.from(image.data, "base64"));
    };
    let customerId = null;
    try {
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      const { data: demoCustomer } = await admin.from("customers").select("company_name, customer_number").eq("is_demo", true).order("customer_number").limit(1).single();
      await page.open(`${BASE}/dashboard/kunden?suche=${encodeURIComponent(demoCustomer.customer_number)}`);
      const listed = await page.eval(`({ nav: !!document.querySelector('.dash-nav a[href="/dashboard/kunden"]'), rows: [...document.querySelectorAll("a[href^='/dashboard/kunden/']")].map((a) => a.textContent) })`);
      check("Dispatcher: „Kunden“ in der Navigation, Suche nach Kundennummer findet den Kunden", listed.nav && listed.rows.some((t) => t.includes(demoCustomer.company_name)), JSON.stringify(listed));
      await shot("kunden-1440.png");

      // task-16-3: view „Mit SLA-Vertrag“ lists active customers with a contract valid today; badge in the list, contracts on the customer page
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
      const { data: contracts } = await admin.from("service_contracts").select("customer_number, emergency_24_7, valid_from, valid_until");
      const slaNumbers = [...new Set(contracts.filter((c) => c.customer_number && c.valid_from <= today && (!c.valid_until || c.valid_until >= today)).map((c) => c.customer_number))];
      const { count: slaCount } = await admin.from("customers").select("id", { count: "exact", head: true }).eq("is_active", true).in("customer_number", slaNumbers.length ? slaNumbers : ["-"]);
      await page.open(`${BASE}/dashboard/kunden?ansicht=sla`);
      const slaView = await page.eval(`({ menu: document.querySelector('.side-menu--wide a[href="/dashboard/kunden?ansicht=sla"]')?.textContent ?? "", total: document.querySelector(".result-count strong")?.textContent ?? "", rows: [...document.querySelectorAll("tbody tr")].length, badges: [...document.querySelectorAll("tbody [data-sla]")].map((b) => b.textContent) })`);
      check(`  Kunden „Mit SLA-Vertrag“: ${slaCount} aktive Kunden mit heute gültigem Vertrag, jeder mit SLA-Kennzeichen`,
        slaView.menu.includes("Mit SLA-Vertrag") && slaView.total.startsWith(`${slaCount} `) && slaView.rows === Math.min(slaCount, 50) && slaView.badges.length === slaView.rows && slaView.badges.every((b) => b === "SLA" || b === "SLA 24/7"), JSON.stringify(slaView));
      const expired = contracts.find((c) => c.customer_number && c.valid_until && c.valid_until < today);
      if (expired) {
        await page.open(`${BASE}/dashboard/kunden?ansicht=alle&suche=${encodeURIComponent(expired.customer_number)}`);
        check("  Abgelaufener Vertrag: Kennzeichen „SLA abgelaufen“, nicht in „Mit SLA-Vertrag“", (await page.eval(`document.querySelector("tbody [data-sla]")?.textContent`)) === "SLA abgelaufen" && !slaNumbers.includes(expired.customer_number));
      }
      const { data: slaCustomer } = await admin.from("customers").select("id, customer_number").eq("customer_number", "K-10000").maybeSingle();
      if (slaCustomer) {
        for (const width of [390, 768, 1440]) {
          await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
          await page.open(`${BASE}/dashboard/kunden/${slaCustomer.id}`);
          const shown = await page.eval(`document.querySelector("[data-contracts]")?.textContent ?? ""`);
          check(`  Kundenseite K-10000: Vertrag SLA-2021-801 mit 24/7, Laufzeit und Standorten, ohne Querscrollen @${width}`, /SLA-2021-801/.test(shown) && shown.includes("SLA 24/7") && shown.includes("seit 01.03.2021") && await noScroll(), shown);
          await shot(`kunde-sla-${width}.png`);
          await page.open(`${BASE}/dashboard/kunden?ansicht=sla`);
          await shot(`kunden-sla-${width}.png`);
        }
        await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      }

      await page.open(`${BASE}/dashboard/kunden`);
      check("  Kunde anlegen: kein Eingabefeld für die Kundennummer, Hinweis „Wird beim Anlegen vergeben“ (task-15-2)",
        await page.eval(`!document.querySelector('form [name="customer_number"]') && document.querySelector("[data-number-auto]")?.textContent.includes("Wird beim Anlegen vergeben")`));
      await fillIn(`[...document.querySelectorAll("details.action")].find((d) => d.querySelector("summary").textContent.includes("Kunde anlegen"))`,
        { company_name: company, business_email: `kunde-${runId}@example.com`, street_house_number: "Testweg 7", postal_code: "68159", city: "Mannheim" });
      const created = await waitFor(async () => Boolean((await admin.from("customers").select("id").eq("company_name", company).maybeSingle()).data));
      const { data: customer } = await admin.from("customers").select("id, customer_number").eq("company_name", company).single();
      customerId = customer?.id ?? null;
      check("  Kunde anlegen: Kundennummer automatisch, Weiterleitung zur Kundenseite", created && /^K-2\d{4}$/.test(customer.customer_number)
        && await waitFor(async () => (await page.eval("location.pathname")) === `/dashboard/kunden/${customer.id}`), JSON.stringify(customer));
      check("  Hinweis nennt die vergebene Kundennummer", await waitFor(async () => (await page.eval(`document.querySelector(".notice")?.textContent ?? ""`)) === `Kunde ${customer.customer_number} angelegt.`));
      check("  Herkunft „Manuell angelegt“", await waitFor(async () => (await page.eval(`document.querySelector("[data-origin]")?.textContent ?? ""`)) === "Manuell angelegt"));

      // Master data read-only first, the form behind „Stammdaten ändern“ (task-12-8)
      const stammdaten = `document.querySelector("#stammdaten-title").closest("section")`;
      const editBox = `${stammdaten}.querySelector("details.action")`;
      const initial = await page.eval(`(() => ({ facts: ${stammdaten}.querySelector("dl.facts")?.textContent ?? "", open: ${editBox}?.open, summary: ${editBox}?.querySelector("summary").textContent }))()`);
      check("  Stammdaten als Übersicht, Formular eingeklappt unter „Stammdaten ändern“", initial.facts.includes(company) && initial.open === false && initial.summary === "Stammdaten ändern", JSON.stringify(initial));
      await fillIn(editBox, { phone_number: "0621 999000" });
      const saved = await settled(stammdaten, "save-status--success");
      check("  Stammdaten speichern", Boolean(saved) && (await admin.from("customers").select("phone_number").eq("id", customer.id).single()).data.phone_number === "0621 999000", JSON.stringify(saved));
      const closedAfterSave = await waitFor(async () => { const state = await page.eval(`(() => ({ open: ${editBox}.open, tel: ${stammdaten}.querySelector('dl.facts a[href^="tel:"]')?.textContent }))()`); return state.open === false && state.tel === "0621 999000"; });
      check("  nach dem Speichern: Formular zu, Übersicht zeigt die neue Telefonnummer", closedAfterSave);
      await fillIn(`[...document.querySelectorAll("details.action")].find((d) => d.querySelector("summary").textContent.includes("Standort hinzufügen"))`,
        { street_house_number: "Lagerstraße 2", postal_code: "68219", city: "Mannheim", label: "Lager" });
      check("  zweiter Standort", await waitFor(async () => ((await admin.from("customer_sites").select("id").eq("customer_id", customer.id)).data ?? []).length === 2));

      await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await page.open(`${BASE}/dashboard/kunden/${customer.id}`);
      check("  Kundenseite bei 390 px ohne horizontales Scrollen", await noScroll());
      await shot("kunde-390.png");
      await page.open(`${BASE}/dashboard/kunden`);
      check("  Kundenliste bei 390 px ohne horizontales Scrollen", await noScroll());

      // Correction of a request: link with the master data and take company, address and e-mail
      await page.open(`${BASE}/dashboard/anfragen/${req.id}`);
      await page.eval(`(() => { const d = [...document.querySelectorAll(".request-customer details.action")][0]; d.open = true; d.querySelector('[name="copy_data"]').checked = true; })()`);
      await fillIn(`document.querySelector(".request-customer details.action")`, { customer_number: customer.customer_number });
      const linked = await waitFor(async () => Boolean((await admin.from("requests").select("customer_id").eq("id", req.id).single()).data?.customer_id));
      const { data: after } = await admin.from("requests").select("customer_id, company_name, business_email, street_house_number").eq("id", req.id).single();
      check("  Anfrage mit Kunde verknüpft, Firma, Adresse und E-Mail übernommen", linked && after.customer_id === customer.id && after.company_name === company
        && after.business_email === `kunde-${runId}@example.com` && after.street_house_number === "Testweg 7", JSON.stringify(after));
      await page.open(`${BASE}/dashboard/anfragen/${req.id}`);
      check("  Anfrageseite zeigt die Verknüpfung, kein horizontales Scrollen bei 390 px",
        (await page.eval(`document.querySelector(".request-customer")?.textContent ?? ""`)).includes(customer.customer_number) && await noScroll());
      await shot("anfrage-kunde-390.png");
      // Request list: customer number under the company, search by customer number (task-15-2)
      const { data: linkedReq } = await admin.from("requests").select("request_number, customer_number").eq("id", req.id).single();
      await page.open(`${BASE}/dashboard/anfragen?ansicht=alle&suche=${encodeURIComponent(customer.customer_number)}`);
      const listRow = await page.eval(`[...document.querySelectorAll("a[href='/dashboard/anfragen/${req.id}']")].map((a) => a.closest("tr, li, article")?.textContent ?? a.textContent).join(" ")`);
      check("  Anfragenliste: Suche nach Kundennummer findet die Anfrage, Kundennummer unter der Firma, kein horizontales Scrollen bei 390 px",
        linkedReq.customer_number === customer.customer_number && listRow.includes(customer.customer_number) && await noScroll(), JSON.stringify({ linkedReq, listRow: listRow.slice(0, 200) }));
    } finally {
      if (customerId) await admin.from("customers").delete().eq("id", customerId);
    }
  }

  console.log("\nKunde anlegen: Hinweis auf ähnlichen Kunden, Herkunft (task-14-4)");
  {
    const createBox = `[...document.querySelectorAll("details.action")].find((d) => d.querySelector("summary").textContent.includes("Kunde anlegen"))`;
    const { data: similar } = await admin.from("customers").select("customer_number, company_name, customer_sites(postal_code)").eq("is_demo", true).eq("is_active", true).order("customer_number").limit(1).single();
    // Same company as a demo customer plus a unique suffix in the notes: found by company, created only on confirmation
    const marker = `UI-Dublette ${runId}`;
    let duplicateId = null;
    try {
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
      for (const width of [1440, 768, 390]) {
        await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
        await page.open(`${BASE}/dashboard/kunden`);
        if (width === 1440) {
          const intro = await page.eval(`${createBox}.textContent`);
          check("Erklärtext: Kunden entstehen automatisch, Anwendungsfälle genannt", intro.includes("automatisch") && intro.includes("SLA-Vertrag") && intro.includes("Bestandskunden"));
          check("  Liste zeigt die Herkunft je Kunde", await page.eval(`[...document.querySelectorAll("[data-origin]")].some((e) => /^(manuell|aus )/.test(e.textContent))`));
        }
        await fillIn(createBox, { company_name: similar.company_name, street_house_number: "Dublettenweg 1", postal_code: similar.customer_sites[0]?.postal_code ?? "68159", city: "Mannheim", notes: marker });
        const warned = await waitFor(async () => page.eval(`!!document.querySelector(".similar-customers [data-similar='${similar.customer_number}']")`));
        const kept = await page.eval(`${createBox}.querySelector('[name="company_name"]').value`);
        const card = await page.eval(`(() => { const el = document.querySelector(".similar-customers"); return { text: el?.textContent ?? "", scroll: document.documentElement.scrollWidth, width: innerWidth }; })()`);
        check(`  Warnung „Ähnlicher Kunde vorhanden“ mit Kunde und Grund, Eingaben bleiben, kein horizontales Scrollen @${width}`,
          warned && kept === similar.company_name && card.text.includes("Gleiche Firma") && card.scroll <= card.width, JSON.stringify(card).slice(0, 300));
        if (SHOTS) {
          const clip = await page.eval(`(() => { document.documentElement.style.scrollBehavior = "auto"; const el = document.querySelector(".similar-customers"); el.scrollIntoView({ block: "center" });
            const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left - 16), y: Math.max(0, r.top + scrollY - 16), width: Math.min(innerWidth, r.width + 32), height: r.height + 80, scale: 1 }; })()`);
          const image = await page.send("Page.captureScreenshot", { format: "png", clip });
          await writeFile(path.join(SHOTS, `kunde-dublette-${width}.png`), Buffer.from(image.data, "base64"));
        }
      }
      const { count: none } = await admin.from("customers").select("id", { count: "exact", head: true }).eq("notes", marker);
      check("  ohne Bestätigung kein Kunde angelegt", none === 0);
      await page.eval(`(() => { const box = ${createBox}; box.querySelector('[name="confirm_duplicate"]').checked = true; box.querySelector("form").requestSubmit(); })()`);
      const created = await waitFor(async () => Boolean((await admin.from("customers").select("id").eq("notes", marker).maybeSingle()).data));
      duplicateId = (await admin.from("customers").select("id, origin_request_id").eq("notes", marker).maybeSingle()).data?.id ?? null;
      check("  „Trotzdem als neuen Kunden anlegen“ legt an und öffnet die Kundenseite", created
        && await waitFor(async () => (await page.eval("location.pathname")) === `/dashboard/kunden/${duplicateId}`));
    } finally {
      if (duplicateId) await admin.from("customers").delete().eq("id", duplicateId);
    }
  }

  console.log("\nKundennummer in Rechnungen und beim Techniker (task-15-2)");
  {
    // Demo data: an invoice of a linked request, and a visit of technician 1 on a linked request
    const { data: billed } = await admin.from("invoices").select("invoice_number, requests!inner(company_name, customer_number)").not("invoice_number", "is", null)
      .not("requests.customer_number", "is", null).limit(1).single();
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("manager.demo@example.com") });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.open(`${BASE}/dashboard/rechnungen?status=alle&suche=${encodeURIComponent(billed.requests.customer_number)}`);
    const invoiceRows = await page.eval(`[...document.querySelectorAll("tbody tr")].map((tr) => tr.textContent)`);
    check("Rechnungsliste: Suche nach Kundennummer, Kundennummer unter der Firma", invoiceRows.length > 0 && invoiceRows.every((t) => t.includes(billed.requests.customer_number))
      && invoiceRows.some((t) => t.includes(billed.invoice_number)), JSON.stringify(invoiceRows.slice(0, 3)).slice(0, 300));

    // A visit of a demo technician (known password) on a linked request
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const demoTechs = new Map(users.filter((u) => /^technik\d+\.demo@example\.com$/.test(u.email ?? "")).map((u) => [u.id, u.email]));
    const { data: visits } = await admin.from("visits").select("id, technician_id, requests!inner(customer_number)").not("requests.customer_number", "is", null)
      .in("status", ["scheduled", "in_progress", "waiting_parts"]).in("technician_id", [...demoTechs.keys()]).limit(1);
    const visit = visits[0];
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies(demoTechs.get(visit.technician_id)) });
    for (const width of [390, 768, 1440]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
      await page.open(`${BASE}/dashboard/einsatz/${visit.id}`);
      const head = await page.eval(`({ number: document.querySelector(".tech-visit-head [data-customer-number]")?.textContent, scroll: document.documentElement.scrollWidth, width: innerWidth })`);
      check(`  Einsatz: Kundennummer im Kopf, kein horizontales Scrollen @${width}`, head.number === visit.requests.customer_number && head.scroll <= head.width, JSON.stringify(head));
      if (SHOTS) {
        const image = await page.send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(SHOTS, `einsatz-kundennummer-${width}.png`), Buffer.from(image.data, "base64"));
      }
    }
  }

  console.log("\nAutovervollständigung in den Suchen (task-12-4)");
  {
    const KEYS = { ArrowDown: 40, Enter: 13, Escape: 27 };
    const press = async (key) => {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: KEYS[key] });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: KEYS[key] });
    };
    const typeInto = async (selector, text) => {
      await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); })()`);
      await page.send("Input.insertText", { text });
    };
    const options = (selector) => page.eval(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); const list = input && document.getElementById(input.getAttribute("aria-controls")); return list && !list.hidden ? [...list.querySelectorAll('[role="option"]')].map((o) => o.textContent) : []; })()`);
    const suggestAs = async (email, area, q, extra = "") => {
      const cookies = await loginCookies(email);
      const response = await fetch(`${BASE}/dashboard/suche/vorschlaege?bereich=${area}&q=${encodeURIComponent(q)}${extra}`, { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
      return { status: response.status, items: response.ok ? (await response.json()).items : [] };
    };
    const own = await newRequest("suggest", { company_name: `UI-Vorschlag ${runId}` });
    const { data: foreign } = await admin.from("requests").select("request_number").eq("is_demo", true).neq("dispatcher_id", dispoId).not("request_number", "is", null).limit(1).single();
    const { data: invoice } = await admin.from("invoices").select("invoice_number").not("invoice_number", "is", null).limit(1).single();
    const { data: demoCustomer } = await admin.from("customers").select("company_name, customer_number").eq("is_demo", true).eq("is_active", true).order("customer_number").limit(1).single();

    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.open(`${BASE}/dashboard/anfragen`);
    await typeInto("#filter-suche", `UI-Vorschlag ${runId}`);
    const shown = await waitFor(async () => (await options("#filter-suche")).some((t) => t.includes(`UI-Vorschlag ${runId}`)));
    check("Anfragen: Vorschläge beim Tippen", shown, JSON.stringify(await options("#filter-suche")));
    await press("Escape");
    check("  Esc schließt die Liste", (await options("#filter-suche")).length === 0);
    await press("ArrowDown");
    await press("Enter");
    check("  Pfeil runter und Enter öffnen die Anfrage", await waitFor(async () => (await page.eval("location.pathname")) === `/dashboard/anfragen/${own.id}`));
    check("  Dispatcher: keine Vorschläge zu fremden Anfragen", (await suggestAs(dispoEmail, "anfragen", foreign.request_number)).items.length === 0);

    await page.open(`${BASE}/dashboard/kunden`);
    await typeInto("#kunden-suche", demoCustomer.customer_number);
    check("Kunden: Vorschlag mit Kundennummer", await waitFor(async () => (await options("#kunden-suche")).some((t) => t.includes(demoCustomer.company_name))));
    await page.eval(`document.getElementById(document.querySelector("#kunden-suche").getAttribute("aria-controls")).querySelector('[role="option"]').click()`);
    check("  Klick öffnet den Kunden", await waitFor(async () => (await page.eval("location.pathname")).startsWith("/dashboard/kunden/")));
    // Found via the contact person: the suggestion names it (task-12-7)
    const { data: contactCustomer } = await admin.from("customers").select("company_name, contact_name").eq("is_demo", true).not("contact_name", "is", null).order("customer_number").limit(1).single();
    const byContact = await suggestAs(dispoEmail, "kunden", contactCustomer.contact_name);
    check("Kunden: Suche nach Kontaktperson zeigt sie im Vorschlag", byContact.items.some((i) => i.title === contactCustomer.company_name && i.meta.includes(contactCustomer.contact_name)), JSON.stringify(byContact.items[0]));

    // Fill field: customer number in the Kundenstamm block of a request
    await page.open(`${BASE}/dashboard/anfragen/${own.id}`);
    await page.eval(`document.querySelector(".request-customer details.action").open = true`);
    await typeInto("#field-customer_number", demoCustomer.company_name.slice(0, 12));
    const filled = await waitFor(async () => (await options("#field-customer_number")).some((t) => t.includes(demoCustomer.customer_number)));
    const index = (await options("#field-customer_number")).findIndex((t) => t.includes(demoCustomer.customer_number));
    for (let i = 0; i <= index; i += 1) await press("ArrowDown");
    await press("Enter");
    check("Anfrage: Kundennummer per Vorschlag eingetragen, Formular nicht abgeschickt", filled
      && await waitFor(async () => (await page.eval(`document.querySelector("#field-customer_number").value`)) === demoCustomer.customer_number)
      && !(await admin.from("requests").select("customer_id").eq("id", own.id).single()).data.customer_id);

    const managerInvoices = await suggestAs("manager.demo@example.com", "rechnungen", invoice.invoice_number.slice(0, 9));
    check("Rechnungen: Manager erhält Vorschläge mit Link zur Rechnung", managerInvoices.status === 200 && managerInvoices.items.length > 0 && managerInvoices.items.every((i) => i.href.endsWith("#rechnung")), JSON.stringify(managerInvoices).slice(0, 200));
    check("  Dispatcher: Rechnungsvorschläge abgewiesen (403)", (await suggestAs(dispoEmail, "rechnungen", "RE")).status === 403);
    check("  Techniker: Kundenvorschläge abgewiesen (403)", (await suggestAs("technik1.demo@example.com", "kunden", "GmbH")).status === 403);
    const inbox = await suggestAs(dispoEmail, "posteingang", `UI-Vorschlag ${runId}`, `&nachricht=${own.id}`);
    check("Posteingang: Vorschlag wählt die Anfrage zum Zuordnen aus", inbox.items.some((i) => i.href.includes(`auswahl=${own.id}`) && i.href.startsWith("/dashboard/posteingang?")), JSON.stringify(inbox.items[0]));

    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.open(`${BASE}/dashboard/anfragen`);
    await typeInto("#filter-suche", `UI-Vorschlag ${runId}`);
    await waitFor(async () => (await options("#filter-suche")).length > 0);
    check("  390 px: Vorschlagsliste ohne horizontales Scrollen", await page.eval(`document.documentElement.scrollWidth <= window.innerWidth`));
    if (SHOTS) {
      const image = await page.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(SHOTS, "vorschlaege-390.png"), Buffer.from(image.data, "base64"));
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.open(`${BASE}/dashboard/kunden`);
    await typeInto("#kunden-suche", "Brauerei");
    await waitFor(async () => (await options("#kunden-suche")).length > 0);
    if (SHOTS) {
      const image = await page.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(SHOTS, "vorschlaege-1440.png"), Buffer.from(image.data, "base64"));
    }
  }

  console.log("\nAnrufe: Liste, Anruf, Rückruf erledigt, Telefonat in der Anfrage (task-13-7)");
  {
    const company = `UI-Anruf ${runId}`;
    const req = await newRequest("anruf", { company_name: company, source: "phone_agent", source_event_key: `phone_agent:ui-anruf-${runId}` });
    const noScroll = () => page.eval(`document.documentElement.scrollWidth <= window.innerWidth`);
    const asCookie = async (email) => (await loginCookies(email)).map((c) => `${c.name}=${c.value}`).join("; ");
    const { data: call, error: callError } = await admin.from("phone_calls").insert({
      conversation_id: `ui-anruf-${runId}`, started_at: new Date(Date.now() - 600_000).toISOString(), ended_at: new Date(Date.now() - 400_000).toISOString(),
      duration_seconds: 200, in_service_hours: false, category: "neue_anfrage", urgency: "zeitnah", safety_risk: "none_known",
      summary: `UI-Test Zusammenfassung ${runId}`, transcript: `Mira: Guten Tag, hier spricht Mira.\n[Werkzeug anfrage_anlegen: {}]\nAnrufer: Unsere Pumpe ${runId} leckt.`,
      callback_needed: true, callback_reason: "Kunde möchte Rückruf", callback_number: "0621 5566778", sentiment: "neutral", request_id: req.id,
      cost_cents: 5, credits: 1500, analysis: { firma: company, kontakt: "Erika Muster" }, analyzed_at: new Date(Date.now() - 300_000).toISOString(),
      forwarded: true, forward_target: "service_desk", forward_reason: "Kunde möchte einen Menschen", forwarded_at: new Date(Date.now() - 500_000).toISOString(),
    }).select().single();
    if (callError) throw new Error(`Anruf: ${callError.message}`);
    try {
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.open(`${BASE}/dashboard/anrufe?ansicht=rueckruf&suche=${encodeURIComponent(company)}`);
      const listed = await page.eval(`({ nav: !!document.querySelector('.dash-nav a[href="/dashboard/anrufe"]'), rows: [...document.querySelectorAll(".data-table tbody tr")].map((r) => r.textContent) })`);
      check("Dispatcher: „Anrufe“ in der Navigation, Rückruf offen und Suche nach Firma finden den Anruf", listed.nav && listed.rows.length === 1 && listed.rows[0].includes("Rückruf offen") && listed.rows[0].includes(`UI-Test Zusammenfassung ${runId}`), JSON.stringify(listed));
      const suggested = await (await fetch(`${BASE}/dashboard/suche/vorschlaege?bereich=anrufe&q=${encodeURIComponent(company)}`, { headers: { cookie: await asCookie(dispoEmail) } })).json();
      check("  Vorschlag in der Suche führt zum Anruf", suggested.items?.[0]?.href === `/dashboard/anrufe/${call.id}`, JSON.stringify(suggested));

      await page.open(`${BASE}/dashboard/anrufe/${call.id}`);
      const detail = await page.eval(`({ text: document.querySelector(".side-page__main").textContent, turns: document.querySelectorAll(".call-transcript__turn").length, tools: document.querySelectorAll(".call-transcript__tool").length, request: document.querySelector('a[href="/dashboard/anfragen/${req.id}"]')?.textContent ?? null, tel: document.querySelector('.side-page__main a[href^="tel:"]')?.getAttribute("href") })`);
      check("  Anruf: Zusammenfassung, Transkript mit Werkzeug, Anfrage „im Gespräch angelegt“, Demo-Weiterleitung, Rückrufnummer", detail.text.includes(`UI-Test Zusammenfassung ${runId}`) && detail.turns === 2 && detail.tools === 1
        && detail.request !== null && detail.text.includes("im Gespräch angelegt") && detail.text.includes("Außerhalb") && detail.text.includes("An Service Desk (Demo, nicht verbunden)") && detail.tel === "tel:06215566778", JSON.stringify({ ...detail, text: detail.text.slice(0, 200) }));
      if (SHOTS) {
        const image = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        await writeFile(path.join(SHOTS, "anruf-1440.png"), Buffer.from(image.data, "base64"));
      }
      await page.eval(`[...document.querySelectorAll(".side-page__main button")].find((b) => b.textContent.includes("Rückruf erledigt"))?.click()`);
      check("  „Rückruf erledigt“ vermerkt den Dispatcher", await waitFor(async () => (await admin.from("phone_calls").select("callback_done_by").eq("id", call.id).single()).data?.callback_done_by === dispoId));
      await page.open(`${BASE}/dashboard/anrufe/${call.id}`);
      check("  Stand danach „Zurückgerufen“", (await page.eval(`document.querySelector(".side-page__main .rw-chip")?.textContent ?? ""`)).includes("Zurückgerufen"));

      await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      check("  Anruf bei 390 px ohne horizontales Scrollen", await noScroll());
      if (SHOTS) {
        const image = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        await writeFile(path.join(SHOTS, "anruf-390.png"), Buffer.from(image.data, "base64"));
      }
      await page.open(`${BASE}/dashboard/anfragen/${req.id}`);
      const block = await page.eval(`({ head: document.querySelector(".request-head__meta")?.textContent ?? "", block: document.querySelector(".request-calls")?.textContent ?? "", link: !!document.querySelector('.request-calls a[href="/dashboard/anrufe/${call.id}"]') })`);
      check("  Anfrage: Quelle „Telefon (KI)“, Block Telefonat mit Link zum Anruf, 390 px ohne Scrollen", block.head.includes("über Telefon (KI)") && block.link
        && block.block.includes("Anfrage im Gespräch angelegt") && block.block.includes("Rückruf erledigt") && await noScroll(), JSON.stringify(block));
      await page.open(`${BASE}/dashboard/anrufe`);
      check("  Anrufliste bei 390 px ohne horizontales Scrollen", await noScroll());

      // Technicians have no call area (navigation, page, suggestions)
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies("technik1.demo@example.com") });
      await page.open(`${BASE}/dashboard/anrufe/${call.id}`);
      const tech = await page.eval(`({ path: location.pathname, nav: !!document.querySelector('.dash-nav a[href="/dashboard/anrufe"]'), text: document.body.textContent.includes("UI-Test Zusammenfassung") })`);
      const techSuggest = await fetch(`${BASE}/dashboard/suche/vorschlaege?bereich=anrufe&q=${encodeURIComponent(company)}`, { headers: { cookie: await asCookie("technik1.demo@example.com") } });
      check("Techniker: kein Bereich Anrufe, keine Vorschläge", !tech.path.startsWith("/dashboard/anrufe") && !tech.nav && !tech.text && techSuggest.status === 403, JSON.stringify({ ...tech, status: techSuggest.status }));
    } finally {
      await admin.from("phone_calls").delete().eq("id", call.id);
      // The following sections run as the test dispatcher at 1440 px
      await page.send("Network.clearBrowserCookies");
      await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }
  }

  console.log("\nDemo-Anruf bei Mira über die Service-Desk-Nummer mit Minutenbudget (task-13-8, task-13-11)");
  {
    const filler = [];
    const call = () => page.eval(`(() => { const d = document.querySelector("dialog.demo-call"); return d ? { open: d.open, phase: d.dataset.callPhase, text: d.textContent, accept: d.querySelector(".demo-call__round--accept")?.disabled ?? null, privacy: !!d.querySelector('a[href="/datenschutz"]'), scroll: document.documentElement.scrollWidth <= window.innerWidth } : null; })()`);
    const ready = `(document.querySelector("dialog.demo-call")?.textContent ?? "").match(/Heute noch|aufgebraucht/)`;
    try {
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.open(`${BASE}/kontakt`);
      check("Kontaktseite: Hinweis auf den Demo-Anruf, keine Widget-Karte", await page.eval(`document.querySelector(".demo-call-hint")?.textContent.includes("KI-Assistentin Mira") && !document.querySelector(".mira")`));
      await page.eval(`document.querySelector('.panel a.button[href="tel:+4962100000"]').click()`);
      await page.until(ready, 8000);
      const shown = await call();
      check("  Klick auf die Nummer öffnet den Demo-Anruf: Hinweis Demo/KI, Datenschutz-Link, Restminuten", shown?.open === true && shown.phase === "notice" && shown.text.includes("Demo-Projekt")
        && shown.text.includes("mit einer KI") && shown.privacy && shown.text.includes("Heute noch"), JSON.stringify(shown));
      if (SHOTS) {
        const image = await page.send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(SHOTS, "demo-anruf-1440.png"), Buffer.from(image.data, "base64"));
      }
      await page.eval(`document.querySelector(".demo-call__close").click()`);
      check("  Schließen beendet den Dialog", await waitFor(async () => (await call())?.open === false));

      // Phone: the call button of the bottom bar opens the same dialog
      await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await page.open(`${BASE}/leistungen`);
      await page.eval(`document.querySelector('.mobile-action a[href="tel:+4962100000"]').click()`);
      await page.until(ready, 8000);
      const phone = await call();
      check("  390 px: Anruf-Schaltfläche der unteren Leiste öffnet den Demo-Anruf, kein horizontales Scrollen", phone?.open === true && phone.scroll, JSON.stringify(phone));
      if (SHOTS) {
        const image = await page.send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(SHOTS, "demo-anruf-390.png"), Buffer.from(image.data, "base64"));
      }

      // Day budget used up: "anrufen" is disabled
      const used = await admin.from("widget_sessions").insert(Array.from({ length: 4 }, () => ({ client_key: "f".repeat(64), reserved_seconds: 180 }))).select("id");
      filler.push(...(used.data ?? []).map((row) => row.id));
      await page.open(`${BASE}/kontakt`);
      await page.eval(`document.querySelector('.panel a.button[href="tel:+4962100000"]').click()`);
      await page.until(`(document.querySelector("dialog.demo-call")?.textContent ?? "").includes("aufgebraucht")`, 8000);
      const blocked = await call();
      check("  Tagesbudget verbraucht: „Einverstanden, anrufen“ gesperrt, Hinweis", blocked?.accept === true && blocked.text.includes("aufgebraucht"), JSON.stringify(blocked));
      const foreign = await fetch(`${BASE}/api/mira`, { method: "POST", headers: { Origin: "https://fremd.example" } });
      const limited = await fetch(`${BASE}/api/mira`, { method: "POST", headers: { Origin: BASE } });
      check("  API: fremde Herkunft 403, ohne Budget 429 ohne signierte Adresse", foreign.status === 403 && limited.status === 429 && !(await limited.text()).includes("wss://"), `${foreign.status}/${limited.status}`);
    } finally {
      if (filler.length) await admin.from("widget_sessions").delete().in("id", filler);
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }
  }

  console.log("\nPosteingang: nicht zugeordnete E-Mail anzeigen und zuordnen");
  {
    const target = await newRequest("inbox-link", { intake_status: "awaiting_customer", human_review_required: false });
    const subject = `UI-Test Posteingang ${runId}`;
    const { data: mail, error: mailError } = await admin.from("messages").insert({
      inbox_dispatcher_id: dispoId, direction: "incoming", kind: "other", status: "received", from_address: target.business_email,
      subject, body_text: "Guten Tag, wann kommt Ihr Techniker? Eine Anfragenummer liegt mir nicht vor.", received_at: new Date().toISOString(),
    }).select().single();
    if (mailError) throw new Error(`Posteingang: ${mailError.message}`);
    const extraMails = [];
    try {
      await page.open(`${BASE}/dashboard/posteingang`);
      const listed = await page.eval(`({ badge: document.querySelector('.dash-nav a[href="/dashboard/posteingang"] .dash-nav__count')?.textContent ?? null, subjects: [...document.querySelectorAll(".inbox-item__subject")].map((e) => e.textContent) })`);
      check("Liste zeigt die E-Mail, Zähler in der Navigation", listed.subjects.includes(subject) && Number(listed.badge) >= 1, JSON.stringify(listed));
      await page.open(`${BASE}/dashboard/posteingang?nachricht=${mail.id}`);
      const shown = await page.eval(`({ body: document.querySelector(".inbox-mail__body")?.textContent ?? "", email: document.querySelector('[name="business_email"]')?.value ?? "", target: document.querySelector('[name="target"]')?.value ?? "" })`);
      check("  Text sichtbar, neue Anfrage mit Absender vorbelegt, Anfrage des Absenders vorgeschlagen", shown.body.includes("Anfragenummer liegt mir nicht vor") && shown.email === target.business_email && shown.target.startsWith(target.id), JSON.stringify(shown));
      const placeholder = await page.eval(`(() => { const o = document.querySelector('[name="target"]')?.options[0]; return o ? { value: o.value, text: o.textContent, disabled: o.disabled } : null; })()`);
      check("  leerer Eintrag „Anfrage wählen …“ zuerst, wählbar", placeholder?.value === "" && placeholder.text === "Anfrage wählen …" && !placeholder.disabled, JSON.stringify(placeholder));
      // Only the same domain (task-12-2): suggested and marked, never preselected; the help text names the other ways
      const { data: domainMail, error: domainError } = await admin.from("messages").insert({
        inbox_dispatcher_id: dispoId, direction: "incoming", kind: "other", status: "received", from_address: `fremd-${runId}@example.com`,
        subject: `UI-Test Domain ${runId}`, body_text: "Wann kommt der Techniker?", received_at: new Date().toISOString(),
      }).select().single();
      if (domainError) throw new Error(`Posteingang: ${domainError.message}`);
      extraMails.push(domainMail.id);
      await page.open(`${BASE}/dashboard/posteingang?nachricht=${domainMail.id}`);
      const domainView = await page.eval(`({ value: document.querySelector('[name="target"]')?.value ?? null, labels: [...(document.querySelector('[name="target"]')?.options ?? [])].slice(1).map((o) => o.textContent), missing: document.querySelector(".inbox-mail__missing")?.textContent ?? "" })`);
      check("  nur gleiche Domain: gekennzeichnet, nichts vorausgewählt, Hinweis bei fehlender Anfrage",
        domainView.value === "" && domainView.labels.length > 0 && domainView.labels.every((l) => l.includes("nur gleiche Domain")) && domainView.missing.includes("Neue Anfrage anlegen"), JSON.stringify(domainView));
      // Reply to the sender (task-12-3): template, queued after "Senden", state in the list, customer answer in the conversation
      const replyForm = `document.getElementById("antworten")`;
      const template = await page.eval(`({ subject: document.querySelector('#antworten [name="subject"]')?.value, body: document.querySelector('#antworten [name="body_text"]')?.value ?? "" })`);
      check("  Antworten: Betreff „AW: …“, Vorlage fragt nach Anfragenummer und Standort, mit Namen", template.subject === `AW: UI-Test Domain ${runId}` && template.body.includes("Anfragenummer") && template.body.includes("Standort") && template.body.includes("Mit freundlichen Grüßen"), JSON.stringify(template));
      await fillIn(replyForm, { body_text: `Bitte nennen Sie uns Ihre Anfragenummer. ${runId}` });
      const replied = await waitFor(async () => (await admin.from("messages").select("id").eq("inbox_root_id", domainMail.id).eq("direction", "outgoing")).data?.length === 1);
      const { data: reply } = await admin.from("messages").select("status, to_address, approved_by, request_id").eq("inbox_root_id", domainMail.id).eq("direction", "outgoing").single();
      check("  Senden stellt die Antwort in die Warteschlange (an den Absender, freigegeben vom Dispatcher, ohne Anfrage)",
        replied && reply.status === "queued" && reply.to_address === domainMail.from_address && reply.approved_by === dispoId && reply.request_id === null, JSON.stringify(reply));
      await waitFor(() => page.eval(`location.search.includes("gesendet=1")`));
      const afterReply = await page.eval(`({ notice: [...document.querySelectorAll(".inbox-mail .notice")].map((e) => e.textContent).join(" "), thread: [...document.querySelectorAll(".inbox-thread__item--outgoing")].map((e) => e.textContent).join(" "), state: [...document.querySelectorAll(".inbox-item")].find((a) => a.textContent.includes(${JSON.stringify(`UI-Test Domain ${runId}`)}))?.querySelector(".inbox-item__state")?.textContent ?? null })`);
      check("  danach: Hinweis, Antwort im Verlauf, E-Mail bleibt offen mit „Antwort wird gesendet“",
        afterReply.notice.includes("Versandwarteschlange") && afterReply.thread.includes(runId) && afterReply.state === "Antwort wird gesendet", JSON.stringify(afterReply));
      const { error: answerError } = await admin.from("messages").insert({
        inbox_dispatcher_id: dispoId, inbox_root_id: domainMail.id, direction: "incoming", kind: "customer_reply", status: "received",
        from_address: domainMail.from_address, subject: `Re: UI-Test Domain ${runId}`, body_text: "Unsere Nummer ist RIS-2026-00001.", received_at: new Date(Date.now() + 1000).toISOString(),
      });
      if (answerError) throw new Error(`Posteingang: ${answerError.message}`);
      await page.open(`${BASE}/dashboard/posteingang?nachricht=${domainMail.id}`);
      const answered = await page.eval(`({ items: document.querySelectorAll(".inbox-thread__item").length, state: document.querySelector('.inbox-item[aria-current="true"] .inbox-item__state')?.textContent ?? null, separate: [...document.querySelectorAll(".inbox-item__subject")].filter((e) => e.textContent.startsWith("Re: UI-Test Domain")).length })`);
      check("  Kundenantwort im selben Verlauf, Liste „Neue Antwort“, kein eigener Listeneintrag", answered.items === 2 && answered.state === "Neue Antwort" && answered.separate === 0, JSON.stringify(answered));
      await page.open(`${BASE}/dashboard/posteingang?nachricht=${mail.id}`);
      await fillIn(`[...document.querySelectorAll("form.save-form")].find((f) => f.querySelector('[name="target"]'))`, {});
      const linkedOk = await waitFor(async () => (await admin.from("messages").select("request_id").eq("id", mail.id).single()).data?.request_id === target.id);
      const { data: linkEvents } = await admin.from("request_events").select("actor_id").eq("request_id", target.id).eq("event_type", "message_linked");
      check("  Zuordnung über link_message mit Ereignis des Dispatchers", linkedOk && linkEvents?.some((event) => event.actor_id === dispoId), JSON.stringify(linkEvents));
      await page.open(`${BASE}/dashboard/anfragen/${target.id}`);
      check("  E-Mail steht unter Korrespondenz der Anfrage", await page.eval(`(document.getElementById("korrespondenz-title")?.closest("section, details")?.textContent ?? "").includes(${JSON.stringify(subject)})`));
      await page.open(`${BASE}/dashboard/posteingang?ansicht=zugeordnet`);
      check("  danach nicht mehr offen, unter „Zuletzt zugeordnet“", await page.eval(`[...document.querySelectorAll(".inbox-item")].some((a) => a.textContent.includes(${JSON.stringify(subject)}))`)
        && !(await (await fetch(`${BASE}/dashboard/posteingang`, { headers: { cookie: (await loginCookies(dispoEmail)).map((c) => `${c.name}=${c.value}`).join("; ") } })).text()).includes(subject));
      // Prefill and archive (task-10-10): search prefilled with the sender, new-request fields from the signature
      const signed = `UI-Test Signatur ${runId}`;
      const { data: second, error: secondError } = await admin.from("messages").insert({
        inbox_dispatcher_id: dispoId, direction: "incoming", kind: "other", status: "received", from_address: `m.mustermann@muster-${runId}.de`,
        subject: signed, received_at: new Date().toISOString(),
        body_text: "Sehr geehrte Damen und Herren,\n\nunser Kompressor KAESER SM 13 schaltet ständig ab. Die Produktion steht.\n\nMit freundlichen Grüßen\n\nMax Mustermann\nMuster Metallbau GmbH\nHafenstraße 12\n40213 Düsseldorf\nTel. +49 211 123456-0",
      }).select().single();
      if (secondError) throw new Error(`Posteingang: ${secondError.message}`);
      extraMails.push(second.id);
      await page.open(`${BASE}/dashboard/posteingang?nachricht=${second.id}`);
      const prefilled = await page.eval(`({ search: document.getElementById("inbox-suche")?.value, values: Object.fromEntries([...document.querySelectorAll(".form-grid [name]")].map((e) => [e.name, e.value])), hints: [...document.querySelectorAll(".form-grid .field em")].filter((e) => e.textContent.includes("erkannt")).length })`);
      const v = prefilled.values;
      check("  Suche mit Absenderadresse vorbelegt", prefilled.search === second.from_address, prefilled.search);
      check("  Neue Anfrage aus Signatur und Text vorbelegt, erkannte Felder markiert",
        v.company_name === "Muster Metallbau GmbH" && v.contact_name === "Max Mustermann" && v.street_house_number === "Hafenstraße 12" && v.postal_code === "40213" && v.city === "Düsseldorf"
        && v.phone_number === "+49 211 123456-0" && v.equipment_kind === "compressor" && v.service_kind === "diagnosis_repair" && v.customer_urgency === "production_stop"
        && v.manufacturer === "KAESER" && v.model_type === "SM 13" && prefilled.hints >= 10, JSON.stringify(prefilled));

      const archiveForm = `[...document.querySelectorAll("details.action")].find((d) => d.querySelector("summary").textContent.startsWith("Archivieren"))`;
      await fillIn(archiveForm, { reason: "advertising" });
      const archivedOk = await waitFor(async () => (await admin.from("messages").select("archived_at").eq("id", second.id).single()).data?.archived_at);
      const { data: archivedRow } = await admin.from("messages").select("archived_by, archive_reason, handled_at").eq("id", second.id).single();
      await waitFor(() => page.eval(`location.search.includes("archiviert=")`));
      const afterArchive = await page.eval(`({ undo: document.querySelector(".inbox-undo")?.textContent ?? "", open: [...document.querySelectorAll(".inbox-item__subject")].map((e) => e.textContent) })`);
      check("  Archivieren über archive_message: Grund, Person, Zeit; aus „Offen“ verschwunden, Rückgängig angeboten",
        archivedOk && archivedRow.archived_by === dispoId && archivedRow.archive_reason === "advertising" && archivedRow.handled_at && afterArchive.undo.includes(signed) && !afterArchive.open.includes(signed), JSON.stringify({ archivedRow, afterArchive }));
      await page.open(`${BASE}/dashboard/posteingang?ansicht=archiv&nachricht=${second.id}`);
      check("  im Archiv mit Grund sichtbar", await page.eval(`[...document.querySelectorAll(".inbox-item")].some((a) => a.textContent.includes(${JSON.stringify(signed)}) && a.textContent.includes("Werbung"))`));
      await page.eval(`document.querySelector(".inbox-mail .inbox-undo__form").requestSubmit()`);
      const restored = await waitFor(async () => (await admin.from("messages").select("archived_at").eq("id", second.id).single()).data?.archived_at === null);
      await waitFor(() => page.eval(`!location.search.includes("ansicht=archiv") && document.getElementById("mail-title")?.textContent === ${JSON.stringify(signed)}`));
      check("  Wiederherstellen: wieder unter „Offen“ geöffnet", restored && await page.eval(`document.getElementById("mail-title")?.textContent === ${JSON.stringify(signed)} && !!document.getElementById("inbox-suche")`));
    } finally {
      // A failed run must not leave test e-mails in the inboxes of manager and admin; replies are removed so they are never sent
      await admin.from("messages").delete().in("inbox_root_id", [mail.id, ...extraMails]);
      await admin.from("messages").update({ archived_at: null, archived_by: null, archive_reason: null }).in("id", extraMails);
      await admin.from("messages").update({ request_id: target.id, handled_at: new Date().toISOString() }).in("id", [mail.id, ...extraMails]).is("request_id", null);
    }
  }

  console.log("\nTelefonische Anfrage (task-11-4)");
  {
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.open(`${BASE}/dashboard/erstbearbeitung`);
    check("Erstbearbeitung verlinkt die telefonische Anfrage", await page.eval(`!!document.querySelector('a[href="/dashboard/anfragen/neu"]')`));
    await page.open(`${BASE}/dashboard/anfragen/neu`);
    const phoneForm = `document.querySelector("form.save-form")`;
    const company = `UI-Test Telefon ${runId}`;
    const phoneValues = {
      company_name: company, contact_name: "Paula Anruf", business_email: `ui-telefon-${runId}@example.com`, phone_number: "+49 211 5550",
      street_house_number: "Hafenstraße 3", postal_code: "4021", city: "Düsseldorf", site_label: "Halle 2", equipment_kind: "pump",
      service_kind: "diagnosis_repair", requested_visit_date: "2030-03-04", customer_urgency: "zeitnah", safety_risk: "none_known",
      description: "Pumpe verliert Druck, Anzeige 2 bar statt 4 bar.",
    };
    check("  Formular ohne Dispatcher-Auswahl für Dispatcher, Eingangsbestätigung vorausgewählt",
      await page.eval(`!document.querySelector('[name="dispatcher_id"]') && document.querySelector('[name="send_receipt"]').checked`));
    // Wrong postal code: error, all inputs kept; the receipt stays off so the test never queues an e-mail
    await page.eval(`document.querySelector('[name="send_receipt"]').checked = false`);
    await fillIn(phoneForm, phoneValues);
    let phoneState = await settled(phoneForm, "save-status--error");
    check("  Ungültige PLZ: Fehlermeldung am Feld, Eingaben bleiben erhalten",
      Boolean(phoneState) && phoneState.values.company_name === company && phoneState.values.description === phoneValues.description && phoneState.values.send_receipt === "on"
        && await page.eval(`!!document.getElementById("postal_code-error") && !document.querySelector('[name="send_receipt"]').checked`), JSON.stringify(phoneState));
    await fillIn(phoneForm, { ...phoneValues, postal_code: "40210" });
    const createdPhone = await waitFor(async () => (await admin.from("requests").select("id").eq("company_name", company).maybeSingle()).data);
    const { data: phoneRow } = await admin.from("requests").select("*").eq("company_name", company).single();
    // Take the live request out of the automatic analysis at once (n8n checks open requests every two minutes)
    const dispoClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    await dispoClient.auth.signInWithPassword({ email: dispoEmail, password });
    if (phoneRow) await dispoClient.rpc("cancel_request", { request_id: phoneRow.id, expected_version: phoneRow.version, reason: "UI-Test der telefonischen Anfrage" });
    const receipts = phoneRow ? (await admin.from("messages").select("id").eq("request_id", phoneRow.id)).data : null;
    check("  Anfrage angelegt: Quelle Telefon, dem Dispatcher zugewiesen, RIS-Nummer, ohne Eingangsbestätigung",
      Boolean(createdPhone) && phoneRow.source === "phone" && phoneRow.dispatcher_id === dispoId && phoneRow.request_number.startsWith("RIS-") && phoneRow.site_label === "Halle 2" && receipts?.length === 0,
      JSON.stringify({ source: phoneRow?.source, number: phoneRow?.request_number, receipts }));
    check("  Weiterleitung auf die neue Anfrage", await waitFor(() => page.eval(`location.pathname === ${JSON.stringify(`/dashboard/anfragen/${phoneRow?.id}`)}`)));

    // task-15-4: existing customer chosen by the customer number fills the form and is linked on creation
    const { data: known } = await admin.from("customers").select("id, customer_number, company_name, customer_sites(street_house_number, postal_code, city, is_active, created_at)")
      .eq("is_demo", true).eq("is_active", true).order("customer_number").limit(1).single();
    const knownSite = known.customer_sites.filter((site) => site.is_active).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    const lookup = "#field-customer_number";
    const lookupOptions = () => page.eval(`(() => { const input = document.querySelector(${JSON.stringify(lookup)}); const list = input && document.getElementById(input.getAttribute("aria-controls")); return list && !list.hidden ? [...list.querySelectorAll('[role="option"]')].map((o) => o.textContent) : []; })()`);
    const pickFirst = async () => {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    };
    const lookupState = () => page.eval(`(() => { const form = ${phoneForm}; const v = (n) => form.querySelector('[name="' + n + '"]').value;
      return { first: form.querySelector(":scope > :not([type=hidden])")?.classList.contains("customer-lookup"), number: v("customer_number"), customer: v("customer_id"), company: v("company_name"),
        street: v("street_house_number"), postal: v("postal_code"), city: v("city"), linked: form.querySelector(".customer-lookup__linked")?.textContent ?? null,
        scroll: document.documentElement.scrollWidth, width: window.innerWidth }; })()`);
    for (const width of [390, 768, 1440]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 1000 });
      await page.open(`${BASE}/dashboard/anfragen/neu`);
      await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(lookup)}); el.focus(); })()`);
      await page.send("Input.insertText", { text: known.customer_number });
      const offered = await waitFor(async () => (await lookupOptions()).some((text) => text.includes(known.company_name) && text.includes(knownSite.postal_code)));
      await pickFirst();
      await waitFor(async () => (await lookupState()).customer === known.id);
      const filled = await lookupState();
      check(`Telefonische Anfrage @${width}: Kundennummer zuerst, Vorschläge je Standort, Auswahl füllt Firma und Anschrift, Bestandskunde angezeigt`,
        offered && filled.first && filled.number === known.customer_number && filled.company === known.company_name && filled.postal === knownSite.postal_code
          && filled.street === knownSite.street_house_number && filled.linked?.includes(known.customer_number) && filled.scroll <= filled.width, JSON.stringify(filled));
      if (SHOTS) {
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        await writeFile(path.join(SHOTS, `telefon-bestandskunde-${width}.png`), Buffer.from(shot.data, "base64"));
      }
    }
    await page.eval(`document.querySelector(".customer-lookup__linked button").click()`);
    await waitFor(async () => (await lookupState()).linked === null);
    const unlinked = await lookupState();
    check("  „Verknüpfung lösen“ leert Nummer und Verknüpfung, Angaben bleiben",
      unlinked.customer === "" && unlinked.linked === null && unlinked.number === "" && unlinked.company === known.company_name, JSON.stringify(unlinked));
    await page.send("Input.insertText", { text: known.customer_number });
    await waitFor(async () => (await lookupOptions()).length > 0);
    await pickFirst();
    await waitFor(async () => (await lookupState()).customer === known.id);
    const caller = `UI-Bestandskunde ${runId}`;
    await page.eval(`document.querySelector('[name="send_receipt"]').checked = false`);
    await fillIn(phoneForm, { contact_name: caller, equipment_kind: "pump", service_kind: "diagnosis_repair", requested_visit_date: "2030-03-05",
      customer_urgency: "zeitnah", safety_risk: "none_known", description: "Pumpe verliert Druck, Anzeige 2 bar statt 4 bar." });
    let linkedRow = null;
    await waitFor(async () => (linkedRow = (await admin.from("requests").select("*").eq("contact_name", caller).maybeSingle()).data));
    if (linkedRow) await dispoClient.rpc("cancel_request", { request_id: linkedRow.id, expected_version: linkedRow.version, reason: "UI-Test der telefonischen Anfrage" });
    check("  Anfrage direkt mit dem Bestandskunden verknüpft, Kundennummer aus dem Kundenstamm",
      Boolean(linkedRow) && linkedRow.customer_id === known.id && linkedRow.customer_number === known.customer_number && linkedRow.customer_site_id !== null,
      JSON.stringify({ customer: linkedRow?.customer_id, number: linkedRow?.customer_number, site: linkedRow?.customer_site_id }));
  }

  console.log("\nEinsatzplanung in der Plantafel");
  const processed = { intake_status: "processed", priority: "normal", intake_mode: "manual", intake_completed_at: new Date().toISOString(), manual_minutes_baseline: 15, human_review_required: false };
  const planA = await newRequest("plan-a", processed);
  const planB = await newRequest("plan-b", processed);
  const { data: tech } = await admin.from("profiles").select("id, display_name").eq("display_name", "Tobias Krüger").single();
  // Own Monday per run (2030 onwards), so repeated runs never collide with earlier test bookings
  const weekDate = new Date(Date.UTC(2030, 0, 7) + Math.floor(Math.random() * 1500) * 7 * 86400000);
  const week = weekDate.toISOString().slice(0, 10);
  const utcOffsetHours = new Date(`${week}T12:00:00Z`).toLocaleString("en-US", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }) - 12;
  const visitsOf = async (requestId) => (await admin.from("visits").select("technician_id, scheduled_start, scheduled_end, status").eq("request_id", requestId)).data;
  const bookingForm = `document.querySelector("#auswahl form")`;
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // task-12-1: load next to the names is the calendar month of the shown day and follows the navigation
  {
    const SHORT = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
    const LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
    const loads = () => page.eval(`[...document.querySelectorAll(".plan3__row .plan3__load")].map((e) => ({ text: e.textContent, title: e.title, value: e.dataset.monthLoad }))`);
    const monthOk = (rows, month, year) => rows.length >= 3 && rows.every((row) => row.text.startsWith(`${SHORT[month]} · `) && row.title.startsWith(`${LONG[month]} ${year}:`)
      && (row.value === "abwesend" ? row.text.includes("abwesend") : /^\d+$/.test(row.value) && row.text.includes(`${row.value} % belegt`) && row.title.includes("Arbeitszeit eingeplant")));
    const month = Number(week.slice(5, 7)) - 1;
    await page.open(`${BASE}/dashboard/planung?ansicht=tag&tag=${week}`);
    const current = await loads();
    check(`Plantafel: Auslastung im Monat ${SHORT[month]} neben jedem Techniker, Stunden im Tooltip`, monthOk(current, month, week.slice(0, 4)), JSON.stringify(current));
    const nextMonth = new Date(Date.UTC(Number(week.slice(0, 4)), month + 1, 1)).toISOString().slice(0, 10);
    await page.open(`${BASE}/dashboard/planung?ansicht=tag&tag=${nextMonth}`);
    const next = await loads();
    check("  Monat wechselt mit der Navigation", monthOk(next, Number(nextMonth.slice(5, 7)) - 1, nextMonth.slice(0, 4)), JSON.stringify(next));
  }
  await page.open(`${BASE}/dashboard/planung?woche=${week}&anfrage=${planA.id}`);
  check("Anfrage in „Zu planen“ ausgewählt", await page.eval(`document.querySelector('.plan3__item[aria-current="true"]')?.textContent.includes(${JSON.stringify(planA.request_number)})`));
  // Click at 09:00 (plus a few minutes; the board snaps to the nearest half hour) in Tobias' lane on Monday of the planning board
  await page.eval(`(() => {
    const lane = document.querySelector('.plan3__lane[data-tech="${tech.id}"][data-day="${week}"]');
    const rect = lane.getBoundingClientRect();
    const from = Number(lane.dataset.from), to = Number(lane.dataset.to);
    const x = rect.left + rect.width * (9 * 60 + 5 - from) / (to - from);
    lane.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: rect.top + 5 }));
  })()`);
  let picked = await formStatus(bookingForm);
  check("Klick in den Kalender übernimmt Techniker, Datum und Zeit", picked.values.technician_id === tech.id && picked.values.date === week && picked.values.start === "09:00" && picked.values.end === "11:00", JSON.stringify(picked.values));
  await page.eval(`${bookingForm}.requestSubmit()`);
  const booked = await waitFor(async () => (await visitsOf(planA.id)).length === 1);
  const visitA = (await visitsOf(planA.id))[0];
  const expectedStart = new Date(Date.parse(`${week}T09:00:00Z`) - utcOffsetHours * 3600000).toISOString();
  const expectedEnd = new Date(Date.parse(`${week}T11:00:00Z`) - utcOffsetHours * 3600000).toISOString();
  check(`Einsatz über schedule_visit gebucht (${week} 09:00–11:00 Berlin)`, booked && new Date(visitA.scheduled_start).toISOString() === expectedStart && new Date(visitA.scheduled_end).toISOString() === expectedEnd && visitA.status === "scheduled", JSON.stringify(visitA));
  await page.open(`${BASE}/dashboard/planung?woche=${week}`);
  check("  in der Plantafel als eigene Anfrage sichtbar", await page.eval(`[...document.querySelectorAll(".plan3__blk--own")].some((b) => b.title.includes(${JSON.stringify(planA.request_number)}))`));
  check("  Anfrage verlässt „Zu planen“", await page.eval(`![...document.querySelectorAll(".plan3__item")].some((i) => i.textContent.includes(${JSON.stringify(planA.request_number)}))`));

  // Dragging the selection (task-10-7) with real mouse events in the day view: Monday, Tobias has visit A 09:00–11:00
  {
    const { data: other } = await admin.from("profiles").select("id").eq("display_name", "Anna Lehmann").single();
    await page.open(`${BASE}/dashboard/planung?ansicht=tag&tag=${week}&anfrage=${planB.id}`);
    const laneSel = (techId) => `.plan3__lane[data-tech="${techId}"][data-day="${week}"]`;
    // Viewport x of a minute in a lane, and the pick block's left edge
    const geometry = (techId) => page.eval(`(() => { const lane = document.querySelector('${laneSel(techId)}'); const r = lane.getBoundingClientRect(); const p = document.querySelector(".plan3__blk--pick")?.getBoundingClientRect(); return { left: r.left, width: r.width, y: r.top + r.height / 2, from: Number(lane.dataset.from), to: Number(lane.dataset.to), pick: p ? { x: p.left + 4, y: p.top + p.height / 2 } : null }; })()`);
    const xOf = (g, minute) => g.left + (g.width * (minute - g.from)) / (g.to - g.from);
    const mouse = (type, x, y) => page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
    const dragTo = async (from, to, steps = 12) => {
      await mouse("mousePressed", from.x, from.y);
      for (let i = 1; i <= steps; i += 1) { await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await sleep(15); }
    };
    await page.eval(`document.querySelector(".plan3__board").scrollIntoView({ block: "start", behavior: "instant" })`);
    let g = await geometry(tech.id);
    await page.eval(`document.querySelector('${laneSel(tech.id)}').dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: ${xOf(g, 13 * 60 + 5)}, clientY: ${g.y} }))`);
    g = await geometry(tech.id);
    const gOther = await geometry(other.id);
    g = await geometry(tech.id);
    // Grab 4 px inside the block, so the drop target minute is the block start + 4 px
    await dragTo(g.pick, { x: xOf(gOther, 10 * 60 + 15) + 4, y: gOther.y });
    const tip = await page.eval(`document.querySelector(".plan3__drag-tip")?.textContent ?? ""`);
    await mouse("mouseReleased", xOf(gOther, 10 * 60 + 15) + 4, gOther.y);
    await sleep(300);
    picked = await formStatus(bookingForm);
    check("Ziehen der Auswahl zu anderem Techniker: Zeitanzeige während des Ziehens, 15-Minuten-Raster im Formular", tip.includes("10:15–12:15") && picked.values.technician_id === other.id && picked.values.date === week && picked.values.start === "10:15" && picked.values.end === "12:15", `${tip} ${JSON.stringify(picked.values)}`);
    // Onto visit A (09:30): red while dragging, dropped into the next free window 11:00–13:00
    g = await geometry(other.id);
    const gTech = await geometry(tech.id);
    g = await geometry(other.id);
    await dragTo(g.pick, { x: xOf(gTech, 9 * 60 + 30) + 4, y: gTech.y });
    const conflictShown = await page.eval(`!!document.querySelector(".plan3__drag-tip.is-conflict") && !!document.querySelector(".plan3__blk--pick.is-dragging.is-conflict")`);
    await mouse("mouseReleased", xOf(gTech, 9 * 60 + 30) + 4, gTech.y);
    await sleep(300);
    picked = await formStatus(bookingForm);
    const notice = await page.eval(`document.querySelector(".plan3__notice")?.textContent ?? ""`);
    check("  Konflikt beim Ziehen sichtbar, Ablegen nimmt das nächste freie Fenster", conflictShown && picked.values.technician_id === tech.id && picked.values.start === "11:00" && picked.values.end === "13:00" && notice.includes("Nächstes freies Fenster"), `${conflictShown} ${notice} ${JSON.stringify(picked.values)}`);
    // Keyboard: → moves by 15 minutes, ↑ switches the technician, focus stays on the selection
    await page.eval(`document.querySelector(".plan3__blk--pick").focus()`);
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await sleep(200);
    picked = await formStatus(bookingForm);
    const focused = await page.eval(`document.activeElement?.classList.contains("plan3__blk--pick")`);
    check("  Pfeiltaste verschiebt um 15 Minuten, Fokus bleibt auf der Auswahl", picked.values.start === "11:15" && picked.values.end === "13:15" && focused, JSON.stringify(picked.values));
  }

  // Conflict: same technician and slot for request B → RW410, inputs kept, nothing booked
  await page.open(`${BASE}/dashboard/planung?woche=${week}&anfrage=${planB.id}`);
  await fillIn(bookingForm, { technician_id: tech.id, date: week, start: "10:00", end: "12:00" });
  state = await settled(bookingForm, "save-status--error");
  check("Überschneidung serverseitig abgelehnt, verständlich angezeigt", Boolean(state) && state.status.includes("bereits einen Einsatz") && state.status.includes("freien Zeitraum"), state?.status);
  check("  Eingaben bleiben erhalten, kein Einsatz angelegt", state?.values.start === "10:00" && state?.values.end === "12:00" && (await visitsOf(planB.id)).length === 0);
  await fillIn(bookingForm, { technician_id: tech.id, date: week, start: "18:00", end: "19:00" });
  state = await waitFor(async () => { const s2 = await formStatus(bookingForm); return !s2.pending && s2.values.start === "18:00" && s2.status.includes("error") && !s2.status.includes("bereits einen Einsatz"); }) && await formStatus(bookingForm);
  check("Außerhalb der Arbeitszeit abgelehnt", Boolean(state) && (await visitsOf(planB.id)).length === 0, state?.status);
  await fillIn(bookingForm, { technician_id: tech.id, date: week, start: "11:00", end: "12:00" });
  check("Direkt anschließender Termin (11:00) möglich", await waitFor(async () => (await visitsOf(planB.id)).length === 1));

  // Moving a planned visit on the board (task-10-8): visit B Monday 11:00–12:00 (Tobias), visit A 09:00–11:00 next to it
  {
    console.log("\nGeplanten Einsatz auf der Plantafel verschieben");
    const { data: other } = await admin.from("profiles").select("id").eq("display_name", "Anna Lehmann").single();
    const berlin = (time) => new Date(Date.parse(`${week}T${time}:00Z`) - utcOffsetHours * 3600000).toISOString();
    const visitB = async () => (await visitsOf(planB.id))[0];
    const blockSel = `[...document.querySelectorAll(".plan3__blk--own.is-movable")].find((b) => b.title.includes(${JSON.stringify(planB.request_number)}))`;
    const laneSel = (techId) => `.plan3__lane[data-tech="${techId}"][data-day="${week}"]`;
    const mouse = (type, x, y) => page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 });
    const key = async (name, code) => {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
    };
    // Grab the visit 4 px inside its left edge and drop it so that it starts at the given minute in another lane
    const dragVisit = async (techId, minute) => {
      await page.eval(`document.querySelector(".plan3__board").scrollIntoView({ block: "start", behavior: "instant" })`);
      const g = await page.eval(`(() => { const b = ${blockSel}.getBoundingClientRect(); const lane = document.querySelector('${laneSel(techId)}'); const r = lane.getBoundingClientRect(); return { bx: b.left + 4, by: b.top + b.height / 2, left: r.left, width: r.width, y: r.top + r.height / 2, from: Number(lane.dataset.from), to: Number(lane.dataset.to) }; })()`);
      const x = g.left + (g.width * (minute - g.from)) / (g.to - g.from) + 4;
      await mouse("mousePressed", g.bx, g.by);
      for (let i = 1; i <= 12; i += 1) { await mouse("mouseMoved", g.bx + ((x - g.bx) * i) / 12, g.by + ((g.y - g.by) * i) / 12); await sleep(15); }
      const tip = await page.eval(`document.querySelector(".plan3__drag-tip")?.textContent ?? ""`);
      await mouse("mouseReleased", x, g.y);
      await sleep(300);
      return tip;
    };
    const panel = () => page.eval(`document.querySelector(".plan3__move")?.textContent ?? ""`);
    await page.open(`${BASE}/dashboard/planung?ansicht=tag&tag=${week}`);
    check("Geplanter Einsatz ist ziehbar, Klick-Ziel bleibt die Anfrage", await page.eval(`Boolean(${blockSel}) && ${blockSel}.getAttribute("role") === "button"`));

    // Drag to Anna 14:00, then cancel: nothing saved
    let tip = await dragVisit(other.id, 14 * 60);
    let shown = await panel();
    check("  Ziehen zeigt Zeit am Zeiger, danach Bestätigung alt → neu mit vorbelegtem Grund", tip.includes("14:00–15:00") && shown.includes("11:00–12:00") && shown.includes("14:00–15:00") && shown.includes("Anna Lehmann")
      && await page.eval(`document.querySelector('.plan3__move [name="reason"]').value === "Verschoben auf der Plantafel"`), `${tip} | ${shown}`);
    await page.eval(`[...document.querySelectorAll(".plan3__move button")].find((b) => b.textContent === "Abbrechen").click()`);
    await sleep(200);
    const kept = await visitB();
    check("  Abbrechen: Bestätigung weg, Einsatz unverändert", !(await panel()) && kept.technician_id === tech.id && new Date(kept.scheduled_start).toISOString() === berlin("11:00"), JSON.stringify(kept));

    // Keyboard: → four times = 12:00–13:00, own reason, saved via reschedule_visit with event
    await page.eval(`${blockSel}.focus()`);
    for (let i = 0; i < 4; i += 1) await key("ArrowRight", 39);
    await sleep(200);
    shown = await panel();
    await page.eval(`(() => { const input = document.querySelector('.plan3__move [name="reason"]'); input.value = "Kunde bittet um späteren Termin"; document.querySelector(".plan3__move").requestSubmit(); })()`);
    const movedLater = await waitFor(async () => new Date((await visitB()).scheduled_start).toISOString() === berlin("12:00"));
    const { data: events } = await admin.from("request_events").select("note, data").eq("request_id", planB.id).eq("event_type", "visit_rescheduled");
    check("  Pfeiltasten verschieben, Speichern über reschedule_visit mit Grund im Verlauf", shown.includes("12:00–13:00") && movedLater && events?.length === 1 && events[0].note === "Kunde bittet um späteren Termin", `${shown} | ${JSON.stringify(events)}`);
    check("  Plantafel zeigt den neuen Zeitraum", await waitFor(() => page.eval(`(${blockSel})?.title.includes("12:00–13:00") ?? false`)));

    // Version conflict: the request changed meanwhile → understandable message, nothing moved
    await dragVisit(other.id, 14 * 60);
    await admin.from("requests").update({ site_label: "Parallel geändert" }).eq("id", planB.id);
    await page.eval(`document.querySelector(".plan3__move").requestSubmit()`);
    await waitFor(() => page.eval(`Boolean(document.querySelector(".plan3__move .save-status--error"))`));
    const conflict = await page.eval(`document.querySelector(".plan3__move .save-status--error")?.textContent ?? ""`);
    check("  Versionskonflikt verständlich gemeldet, nichts verschoben", /inzwischen geändert/.test(conflict) && (await visitB()).technician_id === tech.id, conflict);

    // The board reloaded with the new version: saving the same move again (default reason) succeeds, technician changes too
    await sleep(500);
    await page.eval(`document.querySelector(".plan3__move").requestSubmit()`);
    const movedOver = await waitFor(async () => (await visitB()).technician_id === other.id);
    const after = await visitB();
    const { data: request } = await admin.from("requests").select("technician_id").eq("id", planB.id).single();
    const { data: lastEvent } = await admin.from("request_events").select("note").eq("request_id", planB.id).eq("event_type", "visit_rescheduled").order("created_at", { ascending: false }).limit(1).single();
    check("  Ziehen zu anderem Techniker: Einsatz und Anfrage umgehängt, Standardgrund protokolliert", movedOver && new Date(after.scheduled_start).toISOString() === berlin("14:00") && request.technician_id === other.id && lastEvent.note === "Verschoben auf der Plantafel", JSON.stringify({ after, request, lastEvent }));
  }
  console.log("\nEinsatzaktionen und Arbeitserfassung");
  const techEmail = `ui-tech-${runId}@example.com`;
  const { data: techUser } = await admin.auth.admin.createUser({ email: techEmail, password, email_confirm: true });
  const techId = techUser.user.id;
  testAccounts.push(techId);
  await admin.from("profiles").insert({ id: techId, display_name: `UI-Test Techniker ${runId}`, role: "technician" });
  await admin.from("employee_availability").insert([1, 2, 3, 4, 5].map((weekday) => ({ employee_id: techId, kind: "working_hours", weekday, local_start: "07:00", local_end: "16:00" })));
  const job = await newRequest("einsatz", { ...processed, service_kind: "diagnosis_repair", technician_id: techId, work_status: "scheduled" });
  const { data: jobVisit, error: jobVisitError } = await admin.from("visits").insert({ request_id: job.id, technician_id: techId, status: "scheduled", scheduled_start: `${week}T08:00:00Z`, scheduled_end: `${week}T10:00:00Z`, created_by: dispoId }).select().single();
  if (jobVisitError) throw new Error(jobVisitError.message);
  const visitRow = async () => (await admin.from("visits").select("*").eq("id", jobVisit.id).single()).data;
  const entries = async () => (await admin.from("work_entries").select("kind, description, quantity, unit_price, item_status").eq("request_id", job.id).order("created_at")).data;
  const visitUrl = `${BASE}/dashboard/einsatz/${jobVisit.id}`;
  const formIn = (summary) => `[...document.querySelectorAll("details.action")].find((d) => d.querySelector("summary").textContent.trim() === ${JSON.stringify(summary)})`;
  const formWithButton = (text) => `[...document.querySelectorAll("form.save-form")].find((f) => f.querySelector("button[type=submit]").textContent.trim() === ${JSON.stringify(text)})`;

  const otherJar = await loginCookies("technik2.demo@example.com");
  const foreignVisit = await fetch(visitUrl, { headers: { cookie: otherJar.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") }, redirect: "manual" });
  check("Anderer Techniker öffnet den Einsatz nicht (404)", foreignVisit.status === 404, String(foreignVisit.status));

  await page.send("Network.clearBrowserCookies");
  await page.send("Network.setCookies", { cookies: await loginCookies(techEmail) });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.open(visitUrl);
  await page.eval(`${formWithButton("Arbeit starten")}.requestSubmit()`);
  check("Arbeit starten → Einsatz und Anfrage in Arbeit", await waitFor(async () => (await visitRow()).status === "in_progress" && (await dbRequest(job.id)).work_status === "in_progress"));
  // task-11-2: the action bar stays in the card column and at the bottom of the screen, buttons equally high
  for (const width of [390, 768, 1440]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 800 });
    await page.open(visitUrl);
    const bar = await page.eval(`(() => {
      const bar = document.querySelector(".tech-bar").getBoundingClientRect();
      const card = document.querySelector(".tech-page .rw-card").getBoundingClientRect();
      const buttons = [...document.querySelectorAll(".tech-bar a")].map((a) => ({ height: Math.round(a.getBoundingClientRect().height), clipped: a.scrollWidth > a.clientWidth }));
      return { edges: Math.abs(bar.left - card.left) < 1 && Math.abs(bar.right - card.right) < 1, onScreen: bar.bottom <= innerHeight && bar.bottom > innerHeight - 20, buttons };
    })()`);
    check(`Aktionsleiste bündig mit den Karten und unten sichtbar bei ${width} px`, bar.edges && bar.onScreen && bar.buttons.length === 2 && bar.buttons.every((b) => b.height === bar.buttons[0].height && b.height >= 52 && !b.clipped), JSON.stringify(bar));
  }
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  // task-11-3: Route opens Google Maps directions to the request address in a new tab (visit page and Mein Tag)
  {
    const row = await dbRequest(job.id);
    const address = `${row.street_house_number}, ${row.postal_code} ${row.city}`;
    const routeLink = (scope) => `(() => { const link = [...document.querySelectorAll("${scope} a")].find((a) => a.textContent.trim() === "Route"); return link && { href: link.href, target: link.target }; })()`;
    const isRoute = (link) => {
      if (!link || link.target !== "_blank") return false;
      const url = new URL(link.href);
      return url.origin + url.pathname === "https://www.google.com/maps/dir/" && url.searchParams.get("api") === "1" && url.searchParams.get("destination") === address;
    };
    await page.open(visitUrl);
    const onVisit = await page.eval(routeLink(".tech-buttons"));
    check("Route auf der Einsatzseite öffnet Google Maps zur Adresse", isRoute(onVisit), JSON.stringify(onVisit));
    await page.open(`${BASE}/dashboard/heute`);
    const onToday = await page.eval(routeLink(".tech-now .tech-buttons"));
    check("Route auf „Mein Tag“ öffnet Google Maps zur Adresse", isRoute(onToday), JSON.stringify(onToday));
  }

  await page.open(visitUrl);
  await fillIn(formIn("Arbeitszeit erfassen"), { quantity: "1,5" });
  check("Arbeitszeit 1,5 h nach Tarif erfasst", await waitFor(async () => (await entries()).some((entry) => entry.kind === "labor" && Number(entry.quantity) === 1.5 && Number(entry.unit_price) > 0 && entry.item_status === "performed")));
  await page.open(visitUrl);
  await fillIn(formIn("Teil erfassen"), { description: "Gleitringdichtung", quantity: "1", unit_price: "48,90", item_status: "ordered" });
  check("Teil als bestellt mit Preis 48,90 € erfasst", await waitFor(async () => (await entries()).some((entry) => entry.kind === "part" && Number(entry.unit_price) === 48.9 && entry.item_status === "ordered")));
  await page.open(visitUrl);
  await page.eval(`${formWithButton("Als verbaut markieren")}.requestSubmit()`);
  check("Teil als verbaut markiert", await waitFor(async () => (await entries()).some((entry) => entry.kind === "part" && entry.item_status === "used")));

  // Photos: JPEG accepted into the private bucket, PDF rejected
  const setFile = async (file) => {
    const { root } = await page.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file][name=photo]" });
    await page.send("DOM.setFileInputFiles", { nodeId, files: [path.resolve(file)] });
  };
  await page.open(visitUrl);
  await setFile("scripts/demo/files/typenschild-pumpe.jpg");
  await page.eval(`${formWithButton("Foto hochladen")}.requestSubmit()`);
  const photoSaved = await waitFor(async () => (await admin.from("attachments").select("id").eq("visit_id", jobVisit.id)).data.length === 1, 15000);
  const { data: photoRow } = await admin.from("attachments").select("bucket, storage_path, visibility, mime_type").eq("visit_id", jobVisit.id).maybeSingle();
  const stored = photoRow ? await admin.storage.from(photoRow.bucket).download(photoRow.storage_path) : { error: true };
  check("Foto im privaten Bucket „dashboard“ mit Metadaten", photoSaved && photoRow.bucket === "dashboard" && photoRow.storage_path.startsWith(`visits/${job.id}/${jobVisit.id}/`) && photoRow.visibility === "operational" && photoRow.mime_type === "image/jpeg" && !stored.error, JSON.stringify(photoRow));
  const anonymousPhoto = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/dashboard/${photoRow?.storage_path}`);
  check("  nicht öffentlich abrufbar", anonymousPhoto.status >= 400, String(anonymousPhoto.status));
  await page.open(visitUrl);
  const preview = await page.eval(`(async () => { const img = document.querySelector(".photo-grid img"); if (!img) return "kein Bild"; const response = await fetch(img.src); return response.status + " " + response.headers.get("content-type"); })()`);
  check("  Vorschau im Einsatz über die App abrufbar", preview === "200 image/jpeg", preview);
  await setFile("scripts/demo/files/pruefbericht-pumpe.pdf");
  await page.eval(`${formWithButton("Foto hochladen")}.requestSubmit()`);
  state = await settled(formWithButton("Foto hochladen"), "save-status--error");
  check("PDF als Foto abgelehnt, nichts gespeichert", Boolean(state) && state.status.includes("JPEG") && (await admin.from("attachments").select("id").eq("visit_id", jobVisit.id)).data.length === 1, state?.status);

  // Waiting for parts and resume
  await page.open(visitUrl);
  await fillIn(formIn("Auf Teile warten"), { reason: "Lagersatz bestellt" });
  check("Auf Teile warten → Einsatz und Anfrage warten", await waitFor(async () => (await visitRow()).status === "waiting_parts" && (await dbRequest(job.id)).work_status === "waiting_parts"));
  await page.open(visitUrl);
  await page.eval(`${formWithButton("Einsatz fortsetzen")}.requestSubmit()`);
  check("Einsatz fortgesetzt", await waitFor(async () => (await visitRow()).status === "in_progress"));

  // Completion: follow-up without reason keeps the report; with reason the request returns to planning
  await page.open(visitUrl);
  await page.eval(`(() => { const box = document.querySelector('${"input[name=follow_up]"}'); box.checked = true; })()`);
  await fillIn(formIn("Einsatz beenden"), { minutes: "95", summary: "Dichtung getauscht, Probelauf ok", follow_up_reason: "" });
  state = await settled(formIn("Einsatz beenden"), "save-status--error");
  check("Folgeeinsatz ohne Grund: Fehler, Bericht bleibt erhalten", Boolean(state) && state.values.summary === "Dichtung getauscht, Probelauf ok" && (await visitRow()).status === "in_progress", state?.status);
  await fillIn(formIn("Einsatz beenden"), { follow_up_reason: "Zweite Pumpe im Nachbarraum prüfen" });
  const completed = await waitFor(async () => (await visitRow()).status === "completed");
  const jobAfter = await dbRequest(job.id);
  const jobQueue = (await admin.from("dispatcher_queue").select("queue").eq("id", job.id).single()).data.queue;
  const finished = await visitRow();
  check("Einsatz beendet mit Bericht und 95 min", completed && finished.actual_work_minutes === 95 && finished.summary === "Dichtung getauscht, Probelauf ok");
  check("  Anfrage nicht abgeschlossen, Folgeeinsatz in der Planung", jobAfter.work_status === "not_planned" && jobAfter.completed_at === null && jobQueue === "planning", `${jobAfter.work_status} ${jobQueue}`);

  console.log("\nAnfrage abschließen und Rechnung");
  // The technician closes without any manager step; drafts have no PDF; the issued PDF is frozen
  const jobUrl = `${BASE}/dashboard/anfragen/${job.id}`;
  const techCookie = (await loginCookies(techEmail)).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const pdfUrl = `${jobUrl}/rechnung/pdf`;
  const getPdf = async (cookie = techCookie) => {
    const response = await fetch(pdfUrl, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    return { status: response.status, type: response.headers.get("content-type"), disposition: response.headers.get("content-disposition"), cache: response.headers.get("cache-control"), bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const invoiceRow = async () => (await admin.from("invoices").select("*").eq("request_id", job.id).maybeSingle()).data;
  await page.open(jobUrl);
  check("Techniker sieht „Anfrage abschließen“ mit Bericht des letzten Einsatzes", await page.eval(`(() => { const host = ${actionForm("Anfrage abschließen")}; return Boolean(host) && host.querySelector("textarea[name=completion_summary]").value === "Dichtung getauscht, Probelauf ok"; })()`));
  if (SHOTS) {
    await page.eval(`document.getElementById("aktionen").scrollIntoView({ behavior: "instant" })`);
    await sleep(300);
    await writeFile(path.join(SHOTS, "abschluss-390.png"), Buffer.from((await page.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  }
  await fillIn(actionForm("Anfrage abschließen"), { completion_summary: "" });
  state = await settled(actionForm("Anfrage abschließen"), "save-status--error");
  check("Abschluss ohne Bericht abgelehnt", Boolean(state) && (await dbRequest(job.id)).work_status === "not_planned", state?.status);
  await fillIn(actionForm("Anfrage abschließen"), { completion_summary: "Pumpe instand gesetzt, Folgeprüfung nicht mehr nötig" });
  const closed = await waitFor(async () => (await dbRequest(job.id)).work_status === "completed");
  const closeEvents = (await admin.from("request_events").select("event_type, actor_id").eq("request_id", job.id).eq("event_type", "work_completed")).data;
  check("Techniker schließt ab (close_request), ohne Managerfreigabe", closed && closeEvents.length === 1 && closeEvents[0].actor_id === techId, JSON.stringify(closeEvents));
  check("PDF vor Rechnungserstellung: 404", (await getPdf()).status === 404);

  await page.open(jobUrl);
  await page.eval(`${formWithButton("Rechnungsentwurf erstellen")}.requestSubmit()`);
  check("Rechnungsentwurf erstellt (create_invoice)", await waitFor(async () => (await invoiceRow())?.status === "draft"));
  const draftPdf = await getPdf();
  check("PDF eines Entwurfs: 404", draftPdf.status === 404, String(draftPdf.status));
  await page.open(jobUrl);
  check("  Seite zeigt keinen PDF-Link für den Entwurf", await page.eval(`!document.querySelector(".invoice-download")`));

  await page.eval(`${formWithButton("Rechnung ausstellen")}.requestSubmit()`);
  const issued = await waitFor(async () => (await invoiceRow())?.status === "issued");
  const invoice = await invoiceRow();
  check(`Rechnung ausgestellt (${invoice?.invoice_number})`, issued && /^RE-\d{4}-\d{5}$/.test(invoice.invoice_number ?? ""), JSON.stringify(invoice));
  const items = (await admin.from("invoice_items").select("kind, quantity, unit_price, net_amount").eq("invoice_id", invoice.id).order("position")).data;
  check("  Positionen: Arbeitszeit und verbautes Teil", items.length === 2 && items.some((item) => item.kind === "labor") && items.some((item) => item.kind === "part" && Number(item.unit_price) === 48.9), JSON.stringify(items));
  await page.open(jobUrl);
  check("  PDF-Link auf der Anfrageseite, keine Rechnungsaktionen mehr", await page.eval(`Boolean(document.querySelector(".invoice-download a[href$='/rechnung/pdf']")) && !${actionForm("Rechnung ausstellen")} && !${actionForm("Anfrage abschließen")}`));

  const { PDFDocument } = await import("pdf-lib");
  const firstPdf = await getPdf();
  const parsed = firstPdf.status === 200 ? await PDFDocument.load(firstPdf.bytes) : null;
  check("PDF-Download: 200, application/pdf, Anhang, nicht cachebar", firstPdf.status === 200 && firstPdf.type === "application/pdf" && firstPdf.disposition?.includes(`Musterrechnung-${invoice.invoice_number}.pdf`) && firstPdf.cache?.includes("no-store"), `${firstPdf.status} ${firstPdf.type} ${firstPdf.disposition}`);
  check("  als Musterrechnung / Demodaten gekennzeichnet", parsed?.getTitle() === `Musterrechnung / Demodaten ${invoice.invoice_number}` && parsed?.getSubject() === "Musterrechnung / Demodaten", parsed?.getTitle());
  check("  ohne Anmeldung nicht abrufbar", (await getPdf("")).status === 401);
  const otherTechCookie = otherJar.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  check("  fremder Techniker erhält kein PDF (404)", (await getPdf(otherTechCookie)).status === 404);

  // Rate change after issuance must not change the PDF
  const { data: labor } = await admin.from("work_entries").select("service_rate_id").eq("request_id", job.id).eq("kind", "labor").single();
  const { data: rate } = await admin.from("service_rates").select("id, unit_price").eq("id", labor.service_rate_id).single();
  const { error: rateError } = await admin.from("service_rates").update({ unit_price: Number(rate.unit_price) + 50 }).eq("id", rate.id);
  try {
    const secondPdf = await getPdf();
    check("Tarifänderung ändert das ausgestellte PDF nicht (byte-identisch)", !rateError && secondPdf.status === 200 && Buffer.compare(firstPdf.bytes, secondPdf.bytes) === 0, rateError?.message ?? `${firstPdf.bytes.length} / ${secondPdf.bytes.length}`);
  } finally {
    await admin.from("service_rates").update({ unit_price: rate.unit_price }).eq("id", rate.id);
  }
  if (SHOTS) {
    for (const viewport of [{ width: 390, height: 844, mobile: true }, { width: 1440, height: 900, mobile: false }]) {
      await page.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
      await page.open(jobUrl);
      await page.eval(`document.getElementById("rechnung").scrollIntoView({ behavior: "instant" })`);
      await sleep(300);
      const shot = await page.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(SHOTS, `rechnung-${viewport.width}.png`), Buffer.from(shot.data, "base64"));
    }
    await writeFile(path.join(SHOTS, `${invoice.invoice_number}.pdf`), firstPdf.bytes);
  }

  console.log("\nVerwaltung: Konten, Arbeitszeiten, Deaktivierung mit Neuzuweisung, Tarife, Einstellungen");
  {
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const adminRun = Date.now().toString(36);
    const accounts = { technician: `ui-technik-${adminRun}@example.com`, dispatcher: `ui-dispo-neu-${adminRun}@example.com` };
    const created = {};
    for (const [role, email] of Object.entries(accounts)) {
      await page.open(`${BASE}/dashboard/verwaltung`);
      await fillIn(actionForm("Mitarbeitende anlegen"), { display_name: `UI ${role} ${adminRun}`, email, role, password });
      const moved = await page.until(`location.pathname.startsWith("/dashboard/verwaltung/mitarbeitende/")`, 10000);
      created[role] = moved ? await page.eval(`location.pathname.split("/").pop()`) : null;
      check(`${role} über das Formular angelegt, weiter zur Personenseite`, moved && await page.until(`document.querySelector(".notice")?.textContent.includes("Konto angelegt")`));
    }
    const { data: newProfile } = await admin.from("profiles").select("*").eq("id", created.technician).single();
    check("  Profil mit Rolle, aktiv, ohne Passwortfeld", newProfile?.role === "technician" && newProfile.is_active && !Object.keys(newProfile).some((key) => /pass/i.test(key)), JSON.stringify(newProfile));
    check("  neues Konto kann sich anmelden", await loginCookies(accounts.dispatcher).then(() => true, () => false));

    await page.open(`${BASE}/dashboard/verwaltung`);
    await fillIn(actionForm("Mitarbeitende anlegen"), { display_name: "Doppelt", email: accounts.technician, role: "technician", password });
    let state = await settled(actionForm("Mitarbeitende anlegen"), "save-status--error");
    check("doppelte E-Mail-Adresse abgewiesen", state?.status.includes("bereits ein Konto"), state?.status);
    await fillIn(actionForm("Mitarbeitende anlegen"), { email: `ui-kurz-${adminRun}@example.com`, password: "kurz" });
    state = await settled(actionForm("Mitarbeitende anlegen"), "save-status--error");
    check("  zu kurzes Passwort abgewiesen, Eingaben bleiben", state?.values.display_name === "Doppelt" && (await page.eval(`!!document.getElementById("password-error")`)), JSON.stringify(state));

    // Weekly hours of the new technician
    const technicianUrl = `${BASE}/dashboard/verwaltung/mitarbeitende/${created.technician}`;
    await page.open(technicianUrl);
    const hoursForm = formWithButton("Arbeitszeiten speichern");
    const setHours = (days, endOfWednesday) => page.eval(`(() => {
      const form = ${hoursForm};
      for (let day = 1; day <= 7; day += 1) {
        form.querySelector('[name="day_' + day + '"]').checked = ${JSON.stringify(days)}.includes(day);
        form.querySelector('[name="day_' + day + '_start"]').value = "07:00";
        form.querySelector('[name="day_' + day + '_end"]').value = day === 3 ? ${JSON.stringify(endOfWednesday)} : "16:00";
      }
      form.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
    })()`);
    await setHours([1, 2, 3, 4, 5], "06:00");
    state = await settled(hoursForm, "save-status--error");
    check("Arbeitszeit mit Ende vor Beginn abgewiesen", Boolean(state) && (await page.eval(`!!document.getElementById("day_3_end-error")`)), state?.status);
    await setHours([1, 2, 3, 4, 5], "15:00");
    state = await settled(hoursForm, "save-status--success");
    const { data: hours } = await admin.from("employee_availability").select("weekday, local_start, local_end").eq("employee_id", created.technician).eq("kind", "working_hours").order("weekday");
    check("  Mo–Fr gespeichert, Mittwoch bis 15:00", Boolean(state) && hours.length === 5 && hours[2].local_end === "15:00:00", JSON.stringify(hours));
    await page.open(`${BASE}/dashboard/verwaltung/arbeitszeiten`);
    check("  Übersicht zeigt die Wochenzeiten", await page.eval(`document.body.textContent.includes("Mo–Di 07:00–16:00, Mi 07:00–15:00, Do–Fr 07:00–16:00")`));

    // Deactivation of a dispatcher with an open request: reassignment in one step
    const assigned = await newRequest(`verwaltung-${adminRun}`, { dispatcher_id: created.dispatcher, intake_status: "new", human_review_required: false });
    const dispatcherUrl = `${BASE}/dashboard/verwaltung/mitarbeitende/${created.dispatcher}`;
    await page.open(dispatcherUrl);
    const { data: assignedRow } = await admin.from("requests").select("request_number").eq("id", assigned.id).single();
    check("aktive Zuweisung wird vor der Deaktivierung angezeigt", await page.eval(`document.getElementById("zuweisungen-title").parentElement.textContent.includes(${JSON.stringify(assignedRow.request_number)})`));
    const deactivateForm = formWithButton("Deaktivieren");
    await page.eval(`${deactivateForm}.requestSubmit()`);
    state = await settled(deactivateForm, "save-status--error");
    check("  ohne Vertretung nicht möglich", state?.status.includes("Vertretung"), state?.status);
    await page.eval(`(() => { const form = ${deactivateForm}; form.querySelector('[name="replacement_id"]').value = ${JSON.stringify(dispoId)}; form.requestSubmit(); })()`);
    const done = await page.until(`location.search.includes("ergebnis=deaktiviert")`, 10000);
    check("  deaktiviert, 1 Anfrage neu zugewiesen", done && await page.eval(`document.querySelector(".notice")?.textContent.includes("1 Anfragen") && document.querySelector(".notice").textContent.includes("Anmeldung ist gesperrt")`));
    const after = (await admin.from("requests").select("dispatcher_id").eq("id", assigned.id).single()).data;
    const deactivated = (await admin.from("profiles").select("is_active").eq("id", created.dispatcher).single()).data;
    check("  Anfrage bei der Vertretung, Profil inaktiv statt gelöscht", after?.dispatcher_id === dispoId && deactivated?.is_active === false, JSON.stringify({ after, deactivated }));
    check("  Anmeldung gesperrt", await loginCookies(accounts.dispatcher).then(() => false, () => true));
    await page.eval(`${formWithButton("Aktivieren")}.requestSubmit()`);
    check("Reaktivierung gibt die Anmeldung frei", await page.until(`location.search.includes("ergebnis=aktiviert")`, 10000) && await loginCookies(accounts.dispatcher).then(() => true, () => false));

    // Service rates
    await page.open(`${BASE}/dashboard/verwaltung/tarife`);
    const code = `UI-${adminRun}`.toUpperCase();
    await fillIn(actionForm("Tarif anlegen"), { code, display_name: "UI-Test Pauschale", service_kind: "inspection", billing_model: "fixed", unit_price: "99,5", tax_rate: "19" });
    state = await settled(actionForm("Tarif anlegen"), "save-status--success");
    const { data: newRate } = await admin.from("service_rates").select("*").eq("code", code).maybeSingle();
    check("Tarif angelegt (Preis mit Komma)", Boolean(state) && Number(newRate?.unit_price) === 99.5 && newRate?.is_active, JSON.stringify(newRate));
    await page.open(`${BASE}/dashboard/verwaltung/tarife`);
    const rateForm = `[...document.querySelectorAll(".rate-list details.action")].find((d) => d.querySelector("summary").textContent.includes(${JSON.stringify(code)}))`;
    await page.eval(`(() => { const host = ${rateForm}; host.open = true; const form = host.querySelector("form"); form.querySelector('[name="unit_price"]').value = "105"; form.querySelector('[name="is_active"]').checked = false; form.requestSubmit(); })()`);
    await settled(rateForm, "save-status--success");
    const { data: changedRate } = await admin.from("service_rates").select("unit_price, is_active").eq("id", newRate?.id).maybeSingle();
    check("  Tarif geändert und deaktiviert", Number(changedRate?.unit_price) === 105 && changedRate?.is_active === false, JSON.stringify(changedRate));
    await page.open(`${BASE}/dashboard/verwaltung/tarife`);
    const rateListed = () => page.eval(`[...document.querySelectorAll(".rate-list summary")].some((summary) => summary.textContent.includes(${JSON.stringify(code)}))`);
    check("  deaktivierter Tarif standardmäßig ausgeblendet", !(await rateListed()));
    await page.open(`${BASE}/dashboard/verwaltung/tarife?status=alle`);
    check("  unter „Alle“ sichtbar", await rateListed());

    // Settings: invalid value is rejected, a valid change is stored with author and then restored
    const { data: before } = await admin.from("settings").select("*").eq("id", 1).single();
    const settingsForm = formWithButton("Einstellungen speichern");
    await page.open(`${BASE}/dashboard/verwaltung/einstellungen`);
    await fillIn(settingsForm, { manual_intake_minutes: "0" });
    state = await settled(settingsForm, "save-status--error");
    check("Einstellungen: Basiswert 0 abgewiesen", Boolean(state) && (await page.eval(`!!document.getElementById("manual_intake_minutes-error")`)), state?.status);
    await fillIn(settingsForm, { manual_intake_minutes: String(Number(before.manual_intake_minutes) + 1) });
    state = await settled(settingsForm, "save-status--success");
    const { data: changed } = await admin.from("settings").select("*").eq("id", 1).single();
    const adminId = (await admin.from("profiles").select("id").eq("display_name", "Clara Becker").single()).data?.id;
    check("  Basiswert gespeichert mit Autor, Firmenangaben unverändert", Number(changed.manual_intake_minutes) === Number(before.manual_intake_minutes) + 1 && changed.updated_by === adminId && JSON.stringify(changed.company_details) === JSON.stringify(before.company_details), JSON.stringify(changed));
    await page.open(`${BASE}/dashboard/verwaltung/einstellungen`);
    await fillIn(settingsForm, { manual_intake_minutes: String(Number(before.manual_intake_minutes)).replace(".", ",") });
    await settled(settingsForm, "save-status--success");
    const restored = (await admin.from("settings").select("manual_intake_minutes").eq("id", 1).single()).data;
    check("  ursprünglicher Basiswert wiederhergestellt", Number(restored.manual_intake_minutes) === Number(before.manual_intake_minutes));

    // Test accounts stay inactive (no assignments: no replacement needed)
    for (const id of [created.technician, created.dispatcher]) {
      await page.open(`${BASE}/dashboard/verwaltung/mitarbeitende/${id}`);
      await page.eval(`${formWithButton("Deaktivieren")}.requestSubmit()`);
      await page.until(`location.search.includes("ergebnis=deaktiviert")`, 10000);
    }
    const { data: leftovers } = await admin.from("profiles").select("id").in("id", [created.technician, created.dispatcher]).eq("is_active", true);
    check("Testkonten ohne Zuweisungen direkt deaktiviert", leftovers.length === 0, JSON.stringify(leftovers));
    const listed = () => page.eval(`[...document.querySelectorAll(".data-table tbody a")].some((link) => link.getAttribute("href").endsWith(${JSON.stringify(created.technician)}))`);
    await page.open(`${BASE}/dashboard/verwaltung`);
    check("  Mitarbeitende: Deaktivierte standardmäßig ausgeblendet", !(await listed()) && await page.eval(`document.querySelector('.rw-views [aria-current="page"]')?.textContent.startsWith("Aktive")`));
    await page.open(`${BASE}/dashboard/verwaltung?status=alle`);
    check("  unter „Alle“ sichtbar", await listed());
  }

  console.log("\nPasswort vergessen, ändern, zurücksetzen (task-11-5)");
  {
    // Own temporary technician; demo passwords stay untouched. Mails come from the local Mailpit.
    const pwRun = Date.now().toString(36);
    const email = `ui-passwort-${pwRun}@example.com`;
    const { data: pwUser } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    testAccounts.push(pwUser.user.id);
    await admin.from("profiles").insert({ id: pwUser.user.id, display_name: `UI Passwort ${pwRun}`, role: "technician" });
    const mailpit = "http://127.0.0.1:54324/api/v1";
    const mails = async (to, subject) => ((await (await fetch(`${mailpit}/search?query=${encodeURIComponent(`to:${to}`)}`)).json()).messages ?? []).filter((m) => m.Subject.includes(subject));
    const signsIn = async (secret) => {
      const probe = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
      const { error } = await probe.auth.signInWithPassword({ email, password: secret });
      if (!error) await probe.auth.signOut({ scope: "local" });
      return !error;
    };
    const firstForm = `document.querySelector("form.save-form")`;
    await page.send("Network.clearBrowserCookies");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.open(`${BASE}/login`);
    check("Anmeldung verlinkt „Passwort vergessen?“", await page.eval(`!!document.querySelector('a[href="/auth/passwort-vergessen"]')`));

    // Same answer for an unknown and a known address; only the known one gets a mail
    const unknown = `ui-niemand-${pwRun}@example.com`;
    await page.open(`${BASE}/auth/passwort-vergessen`);
    await fillIn(firstForm, { email: unknown });
    const unknownState = await settled(firstForm, "save-status--success");
    await page.open(`${BASE}/auth/passwort-vergessen`);
    await fillIn(firstForm, { email });
    const knownState = await settled(firstForm, "save-status--success");
    const sameText = (state) => state?.status.replace(/ · \d{2}:\d{2}$/, "");
    check("  gleiche Antwort für unbekannte und bekannte Adresse", Boolean(unknownState && knownState) && sameText(unknownState) === sameText(knownState), JSON.stringify([unknownState?.status, knownState?.status]));
    const resetMail = await waitFor(async () => (await mails(email, "Neues Passwort festlegen")).length === 1, 10000);
    check("  Link-E-Mail nur an die bekannte Adresse", resetMail && (await mails(unknown, "Neues Passwort")).length === 0);
    const [message] = await mails(email, "Neues Passwort festlegen");
    const html = message ? (await (await fetch(`${mailpit}/message/${message.ID}`)).json()).HTML : "";
    const link = (html.match(/href="([^"]*token_hash[^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&");
    check("  Link führt zur App, aus der angefordert wurde", link.startsWith(`${BASE}/auth/bestaetigen?token_hash=`), link.slice(0, 80));

    // The link opens the form; a mismatch is rejected, then the new password signs in
    await page.open(link);
    check("  Link öffnet „Neues Passwort festlegen“", await page.eval(`location.pathname === "/auth/passwort-neu" && !!document.querySelector('[name="password_repeat"]')`));
    const first = `Erstes-Neues-${pwRun}`;
    await fillIn(firstForm, { password: first, password_repeat: `${first}x` });
    state = await settled(firstForm, "save-status--error");
    check("  abweichende Wiederholung: Fehler am Feld", Boolean(state) && await page.eval(`!!document.getElementById("password_repeat-error")`), JSON.stringify(state?.status));
    await fillIn(firstForm, { password: first, password_repeat: first });
    check("  gespeichert, danach angemeldet im Dashboard", await page.until(`location.pathname === "/dashboard/heute"`, 10000));
    check("  Anmeldung mit neuem Passwort, altes ungültig", (await signsIn(first)) && !(await signsIn(password)));
    await page.open(`${BASE}/auth/passwort-neu`);
    check("  nach dem Speichern ist das Formular ohne neuen Link gesperrt", await page.eval(`!document.querySelector('[name="password"]')`));
    await page.open(link);
    check("  Link ein zweites Mal: ungültig, neuer Link angeboten", await page.eval(`location.pathname === "/auth/passwort-vergessen" && location.search.includes("link=ungueltig")`));

    // Mein Konto: header link, wrong current password, change
    await page.open(`${BASE}/dashboard/konto`);
    check("  Kopfzeile verlinkt „Mein Konto“", await page.eval(`!!document.querySelector('.dash-header a.dash-user[href="/dashboard/konto"]')`));
    const second = `Zweites-Neues-${pwRun}`;
    await fillIn(firstForm, { current_password: "falsch-falsch-falsch", password: second, password_repeat: second });
    state = await settled(firstForm, "save-status--error");
    check("Mein Konto: falsches aktuelles Passwort abgewiesen", Boolean(state) && await page.eval(`!!document.getElementById("current_password-error")`) && (await signsIn(first)), state?.status);
    await fillIn(firstForm, { current_password: first, password: second, password_repeat: second });
    state = await settled(firstForm, "save-status--success");
    check("  Passwort geändert, Felder geleert, Anmeldung nur mit neuem", Boolean(state) && (await signsIn(second)) && !(await signsIn(first))
      && await page.eval(`[...document.querySelectorAll('form.save-form input[type="password"]')].every((input) => input.value === "")`), state?.status);
    check("  Bestätigungs-E-Mail „Passwort geändert“", await waitFor(async () => (await mails(email, "Passwort wurde geändert")).length >= 1, 10000));
    // A normal session cannot use the reset form
    await page.open(`${BASE}/auth/passwort-neu`);
    check("  „Neues Passwort“ ohne Link gesperrt", await page.eval(`!document.querySelector('[name="password"]') && !!document.querySelector('a[href="/auth/passwort-vergessen"]')`));

    // Admin sets a temporary password; not for the own account
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
    await page.open(`${BASE}/dashboard/verwaltung/mitarbeitende/${pwUser.user.id}`);
    const third = `Vorlaeufig-${pwRun}-1`;
    await fillIn(formWithButton("Neues Passwort setzen"), { password: third, password_repeat: third });
    state = await settled(formWithButton("Neues Passwort setzen"), "save-status--success");
    check("Admin: vorläufiges Passwort gesetzt, Anmeldung damit möglich", Boolean(state) && (await signsIn(third)) && !(await signsIn(second)), state?.status);
    const adminSelf = (await admin.from("profiles").select("id").eq("display_name", "Clara Becker").single()).data?.id;
    await page.open(`${BASE}/dashboard/verwaltung/mitarbeitende/${adminSelf}`);
    check("  eigenes Konto: kein Formular, Verweis auf „Mein Konto“", await page.eval(`!${formWithButton("Neues Passwort setzen")} && !!document.querySelector('#passwort-title ~ p a[href="/dashboard/konto"]')`));
  }
} catch (error) {
  console.error(error);
  failures += 1;
} finally {
  // Temporary accounts no longer appear as active staff; demo:seed removes them
  if (cleanupClient) await deactivateTestAccounts(cleanupClient, testAccounts).catch(() => {});
  page?.socket.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failures === 0 ? "Alle UI-Prüfungen bestanden." : `${failures} Prüfung(en) fehlgeschlagen.`}`);
process.exit(failures === 0 ? 0 : 1);
