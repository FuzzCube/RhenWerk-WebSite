// Images of the Compose project on the VPS (task-18-8): the version in ops/vps/docker-compose.yml (Dependabot PRs,
// after the merge on the server through ops/vps/migrate.sh) against the image of the running container. The file
// images.override.yml in the state folder pins services to an older image after a failed update (rollback); compose.sh
// reads it as a second Compose file, until the next good update removes the pin.
// diffImages and overrideYaml are pure (unit tests in tests/unit/images.test.mjs).
//   RHEINWERK_ENV (default /opt/rheinwerk/.env), OPS_COMPOSE_FILE (default ops/vps/docker-compose.yml of the app),
//   OPS_LOG_DIR (state folder, default /opt/rheinwerk/state)
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ENV_FILE = process.env.RHEINWERK_ENV ?? "/opt/rheinwerk/.env";
const COMPOSE_FILE = process.env.OPS_COMPOSE_FILE ?? path.resolve("ops/vps/docker-compose.yml");
export const OVERRIDE_FILE = path.join(process.env.OPS_LOG_DIR ?? "/opt/rheinwerk/state", "images.override.yml");

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...options });

// Only on the server: the Compose file and its secrets exist
export const onServer = () => existsSync(ENV_FILE) && existsSync(COMPOSE_FILE);

// docker compose with the pins (as ops/vps/compose.sh); withPins = false reads the file of the repository alone
export function compose(args, { withPins = true, ...options } = {}) {
  const files = ["-f", COMPOSE_FILE, ...(withPins && existsSync(OVERRIDE_FILE) ? ["-f", OVERRIDE_FILE] : [])];
  return run("docker", ["compose", ...files, "--env-file", ENV_FILE, ...args], options);
}

// Services of the default profile with image, container and named volumes, as in the repository
export function composeServices() {
  const config = JSON.parse(compose(["config", "--format", "json"], { withPins: false }));
  return {
    volumes: Object.fromEntries(Object.entries(config.volumes ?? {}).map(([key, volume]) => [key, volume.name ?? key])),
    services: Object.entries(config.services).map(([service, entry]) => ({
      service, image: entry.image, container: entry.container_name,
      volumes: (entry.volumes ?? []).filter((volume) => volume.type === "volume").map((volume) => volume.source),
    })),
  };
}

export function runningImage(container) {
  try { return run("docker", ["inspect", "-f", "{{.Config.Image}}", container]).trim(); } catch { return null; }
}

const tag = (image) => (image ?? "").split(":").slice(1).join(":") || null;

// Services whose image in the repository differs from the running one; services without a container are skipped
export function diffImages(services, running) {
  return services.filter((entry) => running[entry.service] && running[entry.service] !== entry.image)
    .map((entry) => ({ service: entry.service, image: entry.image, from: tag(running[entry.service]), to: tag(entry.image), previous: running[entry.service] }));
}

export function pendingImages() {
  const { services } = composeServices();
  const running = Object.fromEntries(services.map((entry) => [entry.service, runningImage(entry.container)]));
  return { services, running, changes: diffImages(services, running) };
}

// Pins: {service: image}; empty pins remove the file
export function overrideYaml(pins) {
  const entries = Object.entries(pins).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return null;
  return `# Von scripts/ops/update-run.mjs nach einem gescheiterten Update geschrieben (task-18-8): diese Dienste laufen weiter mit
# dem Image von vorher. Das nächste gelungene Update entfernt den Eintrag; von Hand: Datei löschen, ops/vps/compose.sh up -d
services:
${entries.map(([service, image]) => `  ${service}:\n    image: ${image}`).join("\n")}
`;
}

export function writePins(pins) {
  const text = overrideYaml(pins);
  if (text) writeFileSync(OVERRIDE_FILE, text);
  else rmSync(OVERRIDE_FILE, { force: true });
}

// Pins of the current override file ({} without it)
export function readPins() {
  if (!existsSync(OVERRIDE_FILE)) return {};
  try {
    const config = JSON.parse(run("docker", ["compose", "-f", COMPOSE_FILE, "-f", OVERRIDE_FILE, "--env-file", ENV_FILE, "config", "--format", "json"]));
    const base = JSON.parse(compose(["config", "--format", "json"], { withPins: false }));
    return Object.fromEntries(Object.entries(config.services).filter(([service, entry]) => base.services[service]?.image !== entry.image).map(([service, entry]) => [service, entry.image]));
  } catch {
    return {};
  }
}
