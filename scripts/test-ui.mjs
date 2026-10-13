// Browser checks of the dashboard UI in headless Chrome over the DevTools protocol (task-4-2):
// - no horizontal scrolling at 390×844, 768×1024 and 1440×900 for the dashboard areas of every role
// - a failed save keeps all inputs (validation error and simulated version conflict), success shows the save state
// - review actions of the request page (task-5-2) against the database: correction, draft, queue, release,
//   version conflict, rejection; runs as a temporary dispatcher on its own test requests (local data stays, like test:api)
// Usage: npm run build && npm run start, then npm run test:ui
//   APP_URL (default http://localhost:3000), CHROME_PATH (default: Google Chrome on macOS),
//   UI_SCREENSHOTS=<dir> additionally stores a screenshot per page and width.
import { spawn } from "node:child_process";
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
    { email: "admin.demo@example.com", pages: ["/dashboard/bausteine", "/dashboard/verwaltung", "detail:/dashboard/verwaltung", "detail:/dashboard/verwaltung/arbeitszeiten", "/dashboard/verwaltung/arbeitszeiten", "/dashboard/verwaltung/tarife", "/dashboard/verwaltung/einstellungen", "/dashboard/uebersicht", "/dashboard/anfragen", "/dashboard/posteingang"] },
    { email: "manager.demo@example.com", pages: ["/dashboard/uebersicht", "/dashboard/uebersicht?zeitraum=jahr", "/dashboard/rechnungen", "/dashboard/auswertung", "/dashboard/auswertung?bereich=warteschlangen", "/dashboard/auswertung?bereich=automatisierung", "/dashboard/planung", "/dashboard/anfragen", "detail:/dashboard/anfragen?arbeit=completed", "detail:/dashboard/anfragen?erstbearbeitung=needs_review", "/dashboard/posteingang", "/dashboard/posteingang?ansicht=zugeordnet"] },
    { email: "dispo3.demo@example.com", pages: ["/dashboard/erstbearbeitung", "/dashboard/erstbearbeitung?tab=planung", "/dashboard/erstbearbeitung?tab=alle", "/dashboard/posteingang"] },
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
    await page.eval(`document.querySelector('.rw-period a[aria-label="Vorheriger Zeitraum"]').click()`);
    // The note is empty while the period block loads, so wait for the new period's text
    const moved = await page.until(`location.search.includes("datum=") && (${note}) !== "" && !(${note}).startsWith(${JSON.stringify(title)})`);
    check(`Zeitraum zurück: ${title} → vorheriger Monat`, moved, await page.eval(`location.search`));
    check("  vergangener Monat ist vollständig, Weiter-Pfeil vorhanden", await page.eval(`!!document.querySelector('.rw-period a[aria-label="Nächster Zeitraum"]') && !(${note}).includes("laufend")`));
  }

  console.log("\nAuswertung: Diagramme aus Datenbankdaten");
  {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    // One tab per area; only the selected area is rendered
    const figures = [];
    const tabs = { durchsatz: 3, warteschlangen: 4, finanzen: 1, automatisierung: 2 };
    for (const [area, expected] of Object.entries(tabs)) {
      await page.open(`${BASE}/dashboard/auswertung?bereich=${area}`);
      await page.until(`document.querySelectorAll(".figure .recharts-surface").length >= ${expected}`, 10000);
      const shown = await page.eval(`({ current: document.querySelector('.side-menu--wide [aria-current="page"]')?.textContent, figures: [...document.querySelectorAll("figure.figure")].map((f) => ({ id: f.dataset.chart, svg: !!f.querySelector(".recharts-surface"), marks: f.querySelectorAll(".recharts-line-curve, .recharts-bar-rectangle").length, table: f.querySelectorAll(".figure__table tbody tr").length })) })`);
      check(`  Reiter ${area}: nur ${expected} Diagramm(e) dieses Bereichs`, shown.figures.length === expected && shown.current?.toLowerCase() === area, JSON.stringify(shown));
      figures.push(...shown.figures);
    }
    check("10 Diagramme (4 Warteschlangen als Einzeldiagramme) mit Datentabelle gezeichnet", figures.length === 10 && figures.every((f) => f.svg && f.marks > 0 && f.table > 0), JSON.stringify(figures));
    await page.open(`${BASE}/dashboard/auswertung`);
    await page.until(`document.querySelectorAll(".figure .recharts-surface").length >= 3`, 10000);
    // Current month in the flow table equals a direct count in the database (Europe/Berlin)
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "longOffset" }).formatToParts(new Date(`${parts.year}-${parts.month}-01T12:00:00Z`)).find((p) => p.type === "timeZoneName").value.replace("GMT", "") || "+00:00";
    const monthStart = new Date(`${parts.year}-${parts.month}-01T00:00:00${offset}`).toISOString();
    const { count } = await admin.from("requests").select("id", { count: "exact", head: true }).gte("created_at", monthStart);
    const tableValue = await page.eval(`(() => { const rows = [...document.querySelectorAll("#flow-chart .figure__table tbody tr")]; const last = rows.at(-1); return last ? last.querySelectorAll("td")[1].textContent.replace(/\\D/g, "") : null; })()`);
    check(`  Eingänge des laufenden Monats: Tabelle ${tableValue} = Datenbank ${count}`, Number(tableValue) === count);
    // Tooltip of the time savings shows count and baseline
    await page.open(`${BASE}/dashboard/auswertung?bereich=automatisierung`);
    await page.until(`!!document.querySelector("#savings-chart .recharts-surface")`, 10000);
    const box = await page.eval(`(() => { const bars = [...document.querySelectorAll("#savings-chart .recharts-bar-rectangle path, #savings-chart .recharts-bar-rectangle")].map((b) => b.getBoundingClientRect()).filter((r) => r.height > 2); const r = bars.at(-2) ?? bars.at(-1); if (!r) return null; document.querySelector("#savings-chart").scrollIntoView({ block: "center", behavior: "instant" }); return null; })()`);
    await sleep(300);
    const target = await page.eval(`(() => { const bars = [...document.querySelectorAll("#savings-chart .recharts-bar-rectangle path")].map((b) => b.getBoundingClientRect()).filter((r) => r.height > 2); const r = bars.at(-2) ?? bars.at(-1); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    if (target) await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
    const tip = target && await page.until(`!!document.querySelector("#savings-chart [data-savings-detail]")`, 3000) ? await page.eval(`document.querySelector("#savings-chart [data-savings-detail]").textContent`) : "";
    check("  Tooltip Zeitersparnis zeigt Anzahl und Basiswert", /\d+ Anfragen × Basiswert 15 min/.test(tip), `${tip} ${box ?? ""}`);
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
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  const { data: analysis, error: analysisError } = await admin.from("automation_runs").insert({ request_id: request.id, operation_key: `ui:${runId}`, step: "intake_analysis", status: "succeeded", decision: "human_review", started_at: startedAt, finished_at: new Date(Date.now() - 60_000).toISOString() }).select().single();
  if (analysisError) throw new Error(`Automatisierungslauf: ${analysisError.message}`);
  const dbRequest = async (id = request.id) => (await admin.from("requests").select("*").eq("id", id).single()).data;
  const waitFor = async (condition, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await condition()) return true; await sleep(150); }
    return false;
  };
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
  console.log("\nPosteingang: nicht zugeordnete E-Mail anzeigen und zuordnen");
  {
    const target = await newRequest("inbox-link", { intake_status: "awaiting_customer", human_review_required: false });
    const subject = `UI-Test Posteingang ${runId}`;
    const { data: mail, error: mailError } = await admin.from("messages").insert({
      inbox_dispatcher_id: dispoId, direction: "incoming", kind: "other", status: "received", from_address: target.business_email,
      subject, body_text: "Guten Tag, wann kommt Ihr Techniker? Eine Anfragenummer liegt mir nicht vor.", received_at: new Date().toISOString(),
    }).select().single();
    if (mailError) throw new Error(`Posteingang: ${mailError.message}`);
    try {
      await page.open(`${BASE}/dashboard/posteingang`);
      const listed = await page.eval(`({ badge: document.querySelector('.dash-nav a[href="/dashboard/posteingang"] .dash-nav__count')?.textContent ?? null, subjects: [...document.querySelectorAll(".inbox-item__subject")].map((e) => e.textContent) })`);
      check("Liste zeigt die E-Mail, Zähler in der Navigation", listed.subjects.includes(subject) && Number(listed.badge) >= 1, JSON.stringify(listed));
      await page.open(`${BASE}/dashboard/posteingang?nachricht=${mail.id}`);
      const shown = await page.eval(`({ body: document.querySelector(".inbox-mail__body")?.textContent ?? "", email: document.querySelector('[name="business_email"]')?.value ?? "", target: document.querySelector('[name="target"]')?.value ?? "" })`);
      check("  Text sichtbar, neue Anfrage mit Absender vorbelegt, Anfrage des Absenders vorgeschlagen", shown.body.includes("Anfragenummer liegt mir nicht vor") && shown.email === target.business_email && shown.target.startsWith(target.id), JSON.stringify(shown));
      await fillIn(`[...document.querySelectorAll("form.save-form")].find((f) => f.querySelector('[name="target"]'))`, {});
      const linkedOk = await waitFor(async () => (await admin.from("messages").select("request_id").eq("id", mail.id).single()).data?.request_id === target.id);
      const { data: linkEvents } = await admin.from("request_events").select("actor_id").eq("request_id", target.id).eq("event_type", "message_linked");
      check("  Zuordnung über link_message mit Ereignis des Dispatchers", linkedOk && linkEvents?.some((event) => event.actor_id === dispoId), JSON.stringify(linkEvents));
      await page.open(`${BASE}/dashboard/anfragen/${target.id}`);
      check("  E-Mail steht unter Korrespondenz der Anfrage", await page.eval(`(document.getElementById("korrespondenz-title")?.closest("section, details")?.textContent ?? "").includes(${JSON.stringify(subject)})`));
      await page.open(`${BASE}/dashboard/posteingang?ansicht=zugeordnet`);
      check("  danach nicht mehr offen, unter „Zuletzt zugeordnet“", await page.eval(`[...document.querySelectorAll(".inbox-item")].some((a) => a.textContent.includes(${JSON.stringify(subject)}))`)
        && !(await (await fetch(`${BASE}/dashboard/posteingang`, { headers: { cookie: (await loginCookies(dispoEmail)).map((c) => `${c.name}=${c.value}`).join("; ") } })).text()).includes(subject));
    } finally {
      // A failed run must not leave the test e-mail in the inboxes of manager and admin
      await admin.from("messages").update({ request_id: target.id, handled_at: new Date().toISOString() }).eq("id", mail.id).is("request_id", null);
    }
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
