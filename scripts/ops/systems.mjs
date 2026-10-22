// State of the systems on the host for the watchdog (task-17-15): website, database, Cloudflare tunnel, e-mail
// dispatch (SMTP), Docker and free disk space; n8n and the phone assistant have their own modules (n8n.mjs, mira.mjs).
// collectSystems gathers the raw answers, evaluateSystems turns them into one entry per system with its checks (pure,
// unit tests in tests/unit/systems-monitor.test.mjs).
//   WEBSITE_URL (default http://127.0.0.1:3000, "off" skips the check), HEALTH_TOKEN, N8N_CONTAINER (default n8n),
//   DISK_WARN_GB (default 20), DISK_CRITICAL_GB (default 5)
// On the VPS (task-18-2) other projects run next to RheinWerk: DOCKER_COMPOSE_PROJECT limits the containers to this
// compose project, SUPABASE_REQUIRED_SERVICES lists the Supabase services it runs (no realtime there).
// SMTP logs in at Gmail without sending, only once an hour (SMTP_CHECK_MINUTES) or on "System prüfen", so that Google
// does not see a login every 5 minutes; in between the previous result stays.
import { execFile } from "node:child_process";
import { statfsSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { verifySmtp } from "../lib/notify.mjs";

const exec = promisify(execFile);
export const SMTP_CHECK_MINUTES = 60;
const REQUIRED_SUPABASE = ["db", "kong", "auth", "rest", "storage", "realtime"];
const requiredSupabase = (env) => env.SUPABASE_REQUIRED_SERVICES?.split(",").map((s) => s.trim()).filter(Boolean) ?? REQUIRED_SUPABASE;
export const SYSTEMS = { website: "Website und Dashboard", database: "Datenbank (Supabase)", tunnel: "Cloudflare-Tunnel", smtp: "E-Mail-Versand (SMTP)", docker: "Docker", disk: "Speicherplatz" };

async function run(command, args) {
  try {
    const { stdout, stderr } = await exec(command, args, { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, out: `${stdout}${stderr}` };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || error.message };
  }
}

async function timed(url, headers = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    let json = null;
    try { json = await response.json(); } catch { /* not JSON */ }
    return { status: response.status, json, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { status: 0, error: error.cause?.code ?? error.name ?? "Fehler", ms: Math.round(performance.now() - started) };
  }
}

// Open connections of cloudflared from its log: the last event per connIndex decides
export function tunnelConnections(log) {
  const state = new Map();
  for (const line of log.split("\n")) {
    const index = line.match(/connIndex=(\d+)/)?.[1];
    if (index === undefined) continue;
    if (line.includes("Registered tunnel connection")) state.set(index, line.match(/location=(\S+)/)?.[1] ?? "");
    else if (/Connection terminated|Unregistered tunnel connection|Serve tunnel error/.test(line)) state.delete(index);
  }
  return [...state.values()];
}

export async function collectSystems(env, { pingDatabase, previous = {}, force = false, now = new Date() }) {
  const base = env.WEBSITE_URL ?? "http://127.0.0.1:3000";
  const n8nContainer = env.N8N_CONTAINER ?? "n8n";
  const smtpDue = force || !previous.smtp?.checked_at || now.getTime() - Date.parse(previous.smtp.checked_at) > (SMTP_CHECK_MINUTES - 3) * 60_000;
  const project = env.DOCKER_COMPOSE_PROJECT ? ["--filter", `label=com.docker.compose.project=${env.DOCKER_COMPOSE_PROJECT}`] : [];
  const [website, database, docker, containers, smtp] = await Promise.all([
    base === "off" ? { off: true } : timed(`${base}/api/health`, env.HEALTH_TOKEN ? { Authorization: `Bearer ${env.HEALTH_TOKEN}` } : {}),
    pingDatabase(),
    run("docker", ["version", "--format", "{{.Server.Version}}"]),
    run("docker", ["ps", "-a", ...project, "--format", "{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}"]),
    smtpDue ? verifySmtp() : null,
  ]);
  const list = containers.ok ? containers.out.trim().split("\n").filter(Boolean).map((line) => {
    const [name, image, state, status] = line.split("\t");
    return { name, image, state, status };
  }) : [];

  // Tunnel as a container (cloudflare/cloudflared) or as a process of the host (brew services)
  let tunnel = { mode: "none" };
  const container = list.find((c) => c.image.startsWith("cloudflare/cloudflared"));
  if (container) {
    const logs = container.state === "running" ? await run("docker", ["logs", "--tail", "3000", container.name]) : { ok: false, out: "" };
    tunnel = { mode: "container", name: container.name, running: container.state === "running", connections: logs.ok ? tunnelConnections(logs.out) : null };
  } else if ((await run("pgrep", ["-x", "cloudflared"])).ok) {
    tunnel = { mode: "process", running: true, connections: null };
  }

  let disk = null;
  try {
    const stats = statfsSync(homedir());
    disk = { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
  } catch { /* not available */ }

  return {
    website, database, tunnel, disk, n8nContainer,
    docker: { ok: docker.ok, version: docker.ok ? docker.out.trim() : null, error: docker.ok ? null : docker.out.split("\n")[0], containers: list },
    smtp: smtp ?? { carried: previous.smtp ?? null },
  };
}

const check = (key, label, ok, severity = "warning", title = "", detail = "") => ({ key, label, ok, severity, title, detail });
const GB = 1024 ** 3;
const gb = (bytes) => `${Math.round(bytes / GB)} GB`;
const stateOf = (checks) => {
  const failed = checks.filter((c) => c.ok === false);
  if (failed.some((c) => c.severity === "critical")) return "critical";
  if (failed.length) return "warning";
  return checks.some((c) => c.ok === true) ? "ok" : "off";
};
const entry = (checks, summary, extra = {}) => ({ state: stateOf(checks), summary, checks, ...extra });

export function evaluateSystems(raw, env = {}) {
  const systems = {};

  const site = raw.website;
  const siteUp = site.status === 200 || site.status === 503;
  systems.website = site.off ? entry([check("system:website", SYSTEMS.website, null, "warning", "", "Website wird hier nicht geprüft (WEBSITE_URL=off)")], null) : entry([siteUp
    ? check("system:website", SYSTEMS.website, true)
    : check("system:website", SYSTEMS.website, false, "critical", "Website und Dashboard nicht erreichbar",
      `Die Website antwortet nicht (${site.status ? `HTTP ${site.status}` : site.error}). Mitarbeiter können das Dashboard nicht öffnen. Läuft Next.js im Entwicklungsordner (npm run dev oder npm run start)? Protokoll im Terminal prüfen.`)],
  siteUp ? `Antwort in ${site.ms} ms` : null);

  const db = raw.database;
  systems.database = entry([db.ok
    ? check("system:datenbank", SYSTEMS.database, true)
    : check("system:datenbank", SYSTEMS.database, false, "critical", "Datenbank nicht erreichbar",
      `Supabase antwortet nicht (${db.error}). Dashboard, Formulare und Automatisierung stehen. Läuft Docker? supabase status, sonst supabase start im Entwicklungsordner (docs/betrieb.md 7).`)],
  db.ok ? `Antwort in ${db.ms} ms` : null);

  const tunnel = raw.tunnel;
  let tunnelCheck;
  let tunnelSummary = null;
  if (tunnel.mode === "none" || !tunnel.running) {
    tunnelCheck = check("system:tunnel", SYSTEMS.tunnel, false, "critical", "Cloudflare-Tunnel läuft nicht",
      `${tunnel.mode === "none" ? "Kein cloudflared gefunden" : `Der Container ${tunnel.name} ist gestoppt`}. n8n und die Werkzeuge des Telefonassistenten sind von außen nicht erreichbar. docker start ${tunnel.name ?? "<cloudflared-Container>"} (docs/betrieb.md 2.1).`);
  } else if (tunnel.connections && tunnel.connections.length === 0) {
    tunnelCheck = check("system:tunnel", SYSTEMS.tunnel, false, "critical", "Cloudflare-Tunnel ohne Verbindung",
      `cloudflared läuft, hat aber keine Verbindung zu Cloudflare. Internetverbindung prüfen, docker logs --tail 50 ${tunnel.name}, notfalls docker restart ${tunnel.name}.`);
  } else {
    tunnelCheck = check("system:tunnel", SYSTEMS.tunnel, true);
    tunnelSummary = tunnel.connections
      ? `${tunnel.connections.length === 1 ? "1 Verbindung" : `${tunnel.connections.length} Verbindungen`} zu Cloudflare${tunnel.connections.some(Boolean) ? ` (${[...new Set(tunnel.connections.filter(Boolean))].join(", ")})` : ""}`
      : "cloudflared läuft";
  }
  systems.tunnel = entry([tunnelCheck], tunnelSummary);

  const smtp = raw.smtp;
  if (!smtp.carried) {
    systems.smtp = entry([smtp.ok === null
      ? check("system:smtp", SYSTEMS.smtp, null, "warning", "", "SMTP_USER oder SMTP_APP_PASSWORD fehlt: Warn-E-Mails werden nicht versendet")
      : smtp.ok
        ? check("system:smtp", SYSTEMS.smtp, true)
        : check("system:smtp", SYSTEMS.smtp, false, "critical", "Warn-E-Mails können nicht versendet werden",
          `Gmail lehnt die Anmeldung ab (${smtp.error}). Warnungen erscheinen nur noch im Dashboard. App-Passwort in .env.local (SMTP_APP_PASSWORD) erneuern, Test mit npm run notify:test.`)],
    smtp.ok ? "Anmeldung bei Gmail erfolgreich" : null, { stale_after_minutes: SMTP_CHECK_MINUTES + 15 });
  }

  const docker = raw.docker;
  const dockerChecks = [];
  let dockerSummary = null;
  if (!docker.ok) {
    dockerChecks.push(check("system:docker", SYSTEMS.docker, false, "critical", "Docker läuft nicht",
      `Docker antwortet nicht (${docker.error}). Datenbank, n8n und Tunnel stehen. Docker Desktop starten; danach supabase start und docker start ${raw.n8nContainer}.`));
  } else {
    dockerChecks.push(check("system:docker", SYSTEMS.docker, true));
    // Required containers must run; every running one must not be unhealthy (edge runtime, studio and the like are
    // optional: the project has no edge functions)
    const services = requiredSupabase(env);
    const required = (c) => c.name === raw.n8nContainer || services.some((service) => c.name.startsWith(`supabase_${service}_`));
    const bad = docker.containers.filter((c) => (required(c) && c.state !== "running") || (c.state === "running" && c.status.includes("(unhealthy)")));
    const missing = services.filter((service) => !docker.containers.some((c) => c.name.startsWith(`supabase_${service}_`))).map((service) => `supabase_${service}`);
    if (!docker.containers.some((c) => c.name === raw.n8nContainer)) missing.push(raw.n8nContainer);
    const problems = [...bad.map((c) => `${c.name}: ${c.status}`), ...missing.map((name) => `${name}: fehlt`)];
    const names = [...bad.map((c) => c.name), ...missing];
    dockerChecks.push(problems.length
      ? check("system:container", "Container", false, "critical", names.length === 1 ? `Container ${names[0]} gestört` : `${names.length} Container gestört`,
        `${problems.join("\n")}\n\nSupabase: supabase stop && supabase start im Entwicklungsordner; n8n: docker start ${raw.n8nContainer}.`)
      : check("system:container", "Container", true));
    const running = docker.containers.filter((c) => c.state === "running").length;
    dockerSummary = `Docker ${docker.version}, ${running === 1 ? "1 Container läuft" : `${running} Container laufen`}`;
  }
  systems.docker = entry(dockerChecks, dockerSummary);

  const disk = raw.disk;
  if (!disk) {
    systems.disk = entry([check("system:speicher", SYSTEMS.disk, null, "warning", "", "Speicherplatz nicht abrufbar")], null);
  } else {
    const warnGb = Number(env.DISK_WARN_GB) || 20;
    const criticalGb = Number(env.DISK_CRITICAL_GB) || 5;
    const free = disk.free / GB;
    const low = free < warnGb;
    systems.disk = entry([low
      ? check("system:speicher", SYSTEMS.disk, false, free < criticalGb ? "critical" : "warning", `Wenig Speicherplatz: ${gb(disk.free)} frei`,
        `Auf dem Rechner sind nur noch ${gb(disk.free)} von ${gb(disk.total)} frei (Warnung unter ${warnGb} GB, kritisch unter ${criticalGb} GB). Bei vollem Speicher scheitern Sicherung, Datenbank und Docker. Platz schaffen: docker system df und docker image prune, alte Sicherungen auf die externe SSD verschieben (docs/betrieb.md 4.4).`)
      : check("system:speicher", SYSTEMS.disk, true)],
    `${gb(disk.free)} von ${gb(disk.total)} frei`, { free_bytes: disk.free, total_bytes: disk.total });
  }
  return systems;
}
