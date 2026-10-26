// Installed and available versions for the area "System" (task-17-15): Docker Desktop, Supabase CLI and images, n8n,
// Node.js and the npm packages. Only shown with a recommendation and the release notes, never installed (user decision
// 21.10.2026). Runs in the nightly job and on "System prüfen". collectVersions asks the host and the registries,
// versionRows turns the answers into rows (pure, unit tests in tests/unit/systems-monitor.test.mjs). On the VPS
// (task-18-8) the images of the Compose project replace Docker Desktop and the Supabase CLI: version in the repository
// against the running one, installed with "Update einspielen" (scripts/ops/update-run.mjs).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { onServer, pendingImages } from "./images.mjs";

const exec = promisify(execFile);
const N8N = process.env.N8N_CONTAINER ?? "n8n";

async function run(command, args) {
  try {
    const { stdout } = await exec(command, args, { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    // npm outdated ends with code 1 when something is outdated, its JSON is still on stdout
    if (error.stdout) return error.stdout;
    return null;
  }
}

async function text(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

const first = (value) => value?.trim().split("\n")[0].trim() || null;

export async function collectVersions() {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const [desktop, appcast, cli, cliLatest, services, containers, n8n, n8nLatest, nodeIndex, outdated] = await Promise.all([
    run("docker", ["version", "--format", "{{.Server.Platform.Name}}"]),
    text(`https://desktop.docker.com/mac/main/${arch}/appcast.xml`),
    run("supabase", ["--version"]),
    run("npm", ["view", "supabase", "version"]),
    run("supabase", ["services", "-o", "json"]),
    run("docker", ["ps", "--format", "{{.Names}}\t{{.Image}}"]),
    run("docker", ["exec", N8N, "n8n", "--version"]),
    run("npm", ["view", "n8n", "version"]),
    text("https://nodejs.org/dist/index.json"),
    run("npm", ["outdated", "--json"]),
  ]);

  let expected = null;
  try { expected = JSON.parse(services); } catch { /* CLI missing */ }
  const running = (containers ?? "").trim().split("\n").filter(Boolean).map((line) => line.split("\t")[1]);
  let node = null;
  try {
    const major = process.versions.node.split(".")[0];
    const releases = JSON.parse(nodeIndex);
    const sameMajor = releases.find((release) => release.version.startsWith(`v${major}.`));
    const lts = releases.find((release) => release.lts);
    node = { latest: sameMajor?.version.slice(1) ?? null, lts: lts ? { version: lts.version.slice(1), codename: lts.lts } : null };
  } catch { /* registry not reachable */ }
  let npm = null;
  try {
    npm = Object.entries(JSON.parse(outdated || "{}")).map(([name, info]) => ({ name, current: info.current, wanted: info.wanted, latest: info.latest }))
      .filter((entry) => entry.current && entry.current !== entry.latest);
  } catch { /* npm failed */ }

  let server = null;
  if (onServer()) {
    try {
      const { services, running } = pendingImages();
      server = { images: services.filter((entry) => running[entry.service]).map((entry) => ({ service: entry.service, running: running[entry.service], wanted: entry.image })) };
    } catch { server = { images: null }; }
  }

  return {
    server,
    docker: { current: desktop?.match(/Docker Desktop ([\d.]+)/)?.[1] ?? null, latest: appcast?.match(/<title>Version ([\d.]+)/)?.[1] ?? null },
    supabaseCli: { current: first(cli), latest: first(cliLatest) },
    // Image versions the installed CLI expects, against the images of the running containers
    supabaseImages: expected ? expected.map((service) => ({
      name: service.name, expected: service.local,
      running: running.find((image) => image.split(":")[0].endsWith(`/${service.name}`))?.split(":")[1] ?? null,
    })).filter((image) => image.running) : null,
    n8n: { current: first(n8n), latest: first(n8nLatest) },
    node: { current: process.versions.node, latest: node?.latest ?? null, lts: node?.lts ?? null },
    npm,
  };
}

const parse = (version) => String(version).replace(/^v/, "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

// Recommendation: current, update (same major version) or a new major version (read the release notes first)
export function advise(current, latest) {
  if (!current || !latest) return { level: "unknown", text: "Nicht geprüft" };
  if (compareVersions(current, latest) >= 0) return { level: "current", text: "Aktuell" };
  if (parse(current)[0] !== parse(latest)[0]) return { level: "major", text: "Neue Hauptversion: erst Release Notes lesen, vorher Sicherung" };
  return { level: "update", text: "Update empfohlen" };
}

const NPM_NOTES = (name) => `https://www.npmjs.com/package/${name}?activeTab=versions`;

export function versionRows(raw) {
  const row = (key, label, current, latest, notes, how, extra = {}) => ({ key, label, current, latest, notes, how, ...advise(current, latest), ...extra });
  const tagOf = (image) => (image ?? "").split(":").slice(1).join(":");
  const rows = raw.server ? [] : [
    row("docker", "Docker Desktop", raw.docker.current, raw.docker.latest, "https://docs.docker.com/desktop/release-notes/",
      "Docker Desktop → Check for updates; vorher Sicherung (npm run backup)"),
    row("supabase_cli", "Supabase CLI", raw.supabaseCli.current, raw.supabaseCli.latest, "https://github.com/supabase/cli/releases",
      "brew upgrade supabase, danach die Images übernehmen"),
  ];

  const images = raw.supabaseImages;
  if (raw.server) {
    const list = raw.server.images;
    const differ = (list ?? []).filter((image) => image.running !== image.wanted);
    rows.push({
      key: "server_images", label: "Images (Server)", notes: "https://github.com/FuzzCube/RhenWerk-WebSite/pulls",
      current: list ? `${list.length} Dienste` : null, latest: list ? (differ.length ? `${differ.length} bereit` : "wie im Repository") : null,
      level: list === null ? "unknown" : differ.length ? "update" : "current",
      text: list === null ? "Nicht geprüft" : differ.length ? "Update bereit" : "Aktuell",
      how: "Neue Versionen kommen als Dependabot-PR; nach dem Merge „Update einspielen“ (Sicherung, Selbsttest, Rückfall bei Fehler; docs/betrieb.md 6)",
      pending: differ.length,
      items: differ.map((image) => ({ name: image.service, current: tagOf(image.running), latest: tagOf(image.wanted) })),
    });
  } else if (images === null) {
    rows.push(row("supabase_images", "Supabase-Images", null, null, "https://github.com/supabase/cli/releases", ""));
  } else {
    const differ = images.filter((image) => image.running !== image.expected);
    rows.push({
      key: "supabase_images", label: "Supabase-Images", notes: "https://github.com/supabase/cli/releases",
      current: `${images.length} Images`, latest: differ.length ? `${differ.length} neuer zur CLI` : "passend zur CLI",
      level: differ.length ? "update" : "current", text: differ.length ? "Update empfohlen" : "Aktuell",
      how: "supabase stop && supabase start im Entwicklungsordner (Daten bleiben erhalten); vorher Sicherung",
      items: differ.map((image) => ({ name: image.name, current: image.running, latest: image.expected })),
    });
  }

  rows.push(row("n8n", "n8n", raw.n8n.current, raw.n8n.latest, "https://docs.n8n.io/release-notes/", raw.server
    ? "Dependabot-PR für n8nio/n8n mergen, danach „Update einspielen“ (docs/betrieb.md 6)"
    : "Neues Image ziehen und Container neu anlegen (docs/betrieb.md 6, vierteljährlich); vorher Sicherung, danach Executions prüfen"));

  const node = row("node", "Node.js", raw.node.current, raw.node.latest,
    raw.node.latest ? `https://nodejs.org/en/blog/release/v${raw.node.latest}` : "https://nodejs.org/en/blog/release",
    "brew upgrade node, danach Festplattenvollzugriff für node erneuern (docs/betrieb.md)");
  const lts = raw.node.lts;
  if (lts && compareVersions(raw.node.current, lts.version) < 0 && parse(raw.node.current)[0] < parse(lts.version)[0]) {
    node.hint = `Neuere LTS-Version ${lts.version} („${lts.codename}“) verfügbar`;
  }
  rows.push(node);

  const npm = raw.npm;
  if (npm === null) {
    rows.push(row("npm", "npm-Pakete", null, null, "https://www.npmjs.com/", ""));
  } else {
    const items = npm.map((pkg) => ({ name: pkg.name, current: pkg.current, latest: pkg.latest, ...advise(pkg.current, pkg.latest), notes: NPM_NOTES(pkg.name) }));
    const major = items.filter((item) => item.level === "major").length;
    rows.push({
      key: "npm", label: "npm-Pakete", notes: "https://www.npmjs.com/",
      current: npm.length ? `${npm.length} mit neuerer Version` : "alle aktuell", latest: null,
      level: major ? "major" : items.length ? "update" : "current",
      text: items.length === 0 ? "Aktuell" : major ? `Update empfohlen, ${major === 1 ? "1 neue Hauptversion" : `${major} neue Hauptversionen`}` : "Update empfohlen",
      how: "Im Entwicklungsordner mit Prüfungen (docs/setup.md, Abhängigkeiten); Hauptversionen einzeln",
      items,
    });
  }
  return rows;
}

// E-mail "Update bereit" (task-29-1): once per version state of the row "Images (Server)". key identifies the state
// (null: nothing pending, the remembered key is dropped); mail only when the key differs from the last one sent.
export function updateReadyMail(rows, lastKey) {
  const items = rows.find((row) => row.key === "server_images")?.items ?? [];
  if (!items.length) return { key: null, mail: null };
  const key = items.map((item) => `${item.name}:${item.latest}`).sort().join(",");
  if (key === lastKey) return { key, mail: null };
  const list = items.map((item) => `${item.name} ${item.current} → ${item.latest}`);
  return {
    key,
    mail: {
      subject: `Systemupdate bereit: ${list.join(", ")}`,
      text: `Neue Versionen liegen auf dem Server und warten auf das Einspielen:\n\n${list.map((line) => `- ${line}`).join("\n")}\n\n`
        + "Dashboard → System → Systemversionen → „Update einspielen“. Vorher wird gesichert, danach geprüft; bei einem Fehler läuft automatisch der Stand von vorher.",
    },
  };
}
