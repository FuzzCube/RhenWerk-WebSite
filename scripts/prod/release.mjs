// Build and activate a release in the production copy (task-17-1, layout in scripts/prod/lib.mjs).
// npm run prod:release                 build origin/main (if not built yet), switch current, restart, check
// npm run prod:release -- <ref>        build another commit or branch of origin
// npm run prod:release -- --no-switch  only build
// npm run prod:release -- --switch <commit>  switch back to an existing release without building
// A failed build never touches current. If the app does not answer after a switch, the previous release is restored.
import { existsSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync, readdirSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import {
  CURRENT, KEEP_RELEASES, LOGS, PORT, PROD_DIR, RELEASES, REPO, SHARED_ENV, currentCommit, ensureLayout, listReleases, log,
  loadService, readRelease, restartService, run, serviceLoaded, switchTo, waitForApp,
} from "./lib.mjs";

const args = process.argv.slice(2);
const noSwitch = args.includes("--no-switch");
const switchIndex = args.indexOf("--switch");
const switchOnly = switchIndex >= 0 ? args[switchIndex + 1] : null;
const ref = args.find((arg, index) => !arg.startsWith("--") && index !== switchIndex + 1) ?? "origin/main";

if (!existsSync(REPO)) {
  console.error(`Keine Produktionskopie unter ${PROD_DIR}. Zuerst: npm run prod:install`);
  process.exit(1);
}
if (!existsSync(SHARED_ENV)) {
  console.error(`${SHARED_ENV} fehlt. Zuerst: npm run prod:install`);
  process.exit(1);
}
ensureLayout();

// One release run at a time (later shared with the nightly update, task-17-5)
const LOCK = path.join(PROD_DIR, ".lock");
try {
  mkdirSync(LOCK);
} catch {
  console.error(`Ein anderer Lauf ist aktiv (${LOCK}). Ist keiner aktiv, den Ordner löschen.`);
  process.exit(1);
}

let exitCode = 0;
try {
  let commit = switchOnly;
  if (switchOnly) {
    if (!readRelease(switchOnly)) throw new Error(`Release ${switchOnly} ist nicht vorhanden (vorhanden: ${listReleases().map((r) => r.short).join(", ") || "keine"})`);
  } else {
    run("git", ["-C", REPO, "fetch", "--quiet", "--prune", "origin"]);
    commit = run("git", ["-C", REPO, "rev-parse", `${ref}^{commit}`]).trim();
    if (readRelease(commit)) log(`Release ${commit.slice(0, 7)} ist bereits gebaut`);
    else build(commit);
  }

  if (!noSwitch) {
    const previous = currentCommit();
    if (previous === commit) {
      log(`Release ${commit.slice(0, 7)} ist bereits aktiv`);
    } else {
      switchTo(commit);
      log(`current → ${commit.slice(0, 7)} (vorher ${previous?.slice(0, 7) ?? "keins"})`);
      const wasLoaded = serviceLoaded();
      if (!loadService()) {
        console.log("App-Dienst ist nicht eingerichtet; nach npm run prod:install startet er aus current.");
      } else {
        if (wasLoaded) restartService();
        if (await waitForApp(commit)) {
          log(`App antwortet auf Port ${PORT} mit ${commit.slice(0, 7)}`);
        } else {
          exitCode = 1;
          log(`FEHLER: App antwortet nicht mit ${commit.slice(0, 7)} (${path.join(LOGS, "web.log")})`);
          if (previous && readRelease(previous)) {
            switchTo(previous);
            restartService();
            log(`Rückfall auf ${previous.slice(0, 7)}: ${(await waitForApp(previous)) ? "App antwortet" : "App antwortet weiterhin nicht"}`);
          }
        }
      }
    }
  }
  prune();
} catch (error) {
  exitCode = 1;
  log(`FEHLER: ${error.message.split("\n")[0]}`);
} finally {
  rmSync(LOCK, { recursive: true, force: true });
}
process.exit(exitCode);

function build(commit) {
  const short = commit.slice(0, 7);
  const target = path.join(RELEASES, commit);
  const work = `${target}.building`;
  const buildLog = path.join(LOGS, `build-${short}.log`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work);
  log(`Baue ${short} (Protokoll ${buildLog})`);
  const started = Date.now();
  const out = openSync(buildLog, "w");
  try {
    run("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", REPO, commit, work]);
    symlinkSync(path.relative(work, SHARED_ENV), path.join(work, ".env.local"));
    run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: work, stdio: ["ignore", out, out] });
    run("npm", ["run", "build"], { cwd: work, stdio: ["ignore", out, out] });
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(`Build von ${short} fehlgeschlagen (${buildLog}): ${error.message.split("\n")[0]}`);
  } finally {
    closeSync(out);
  }
  const [subject, committedAt] = run("git", ["-C", REPO, "log", "-1", "--format=%s%n%cI", commit]).trim().split("\n");
  const migrations = readdirSync(path.join(work, "supabase", "migrations")).filter((file) => file.endsWith(".sql")).sort();
  const release = { commit, short, subject, committed_at: committedAt, built_at: new Date().toISOString(),
    build_seconds: Math.round((Date.now() - started) / 1000), last_migration: migrations.at(-1) ?? null };
  writeFileSync(path.join(work, "release.json"), JSON.stringify(release, null, 2) + "\n");
  run("mv", [work, target]);
  log(`Gebaut: ${short} „${subject}“ in ${release.build_seconds} s`);
}

// Keep the newest KEEP_RELEASES builds; the active release is never removed, leftovers of aborted builds are
function prune() {
  for (const dir of readdirSync(RELEASES)) {
    const full = path.join(RELEASES, dir);
    if (dir.endsWith(".building") || (statSync(full).isDirectory() && !readRelease(dir))) rmSync(full, { recursive: true, force: true });
  }
  const active = currentCommit();
  for (const release of listReleases().slice(KEEP_RELEASES)) {
    if (release.commit === active) continue;
    rmSync(path.join(RELEASES, release.commit), { recursive: true, force: true });
    log(`Altes Release ${release.short} entfernt (behalten: ${KEEP_RELEASES})`);
  }
  if (!existsSync(CURRENT)) console.log("Hinweis: noch kein aktives Release.");
}
