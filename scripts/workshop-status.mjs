// Compact view of the workshop state for agents (task overview without reading the whole roadmap.json).
// npm run workshop:status                 project, progress, phases, open and last completed tasks
// npm run workshop:status -- task-13-6    full JSON of one or more tasks
// Progress is recomputed from roadmap.json (DASHBOARD_CONTRACT.md) and compared with progress.json.
import { readFileSync } from "node:fs";

const read = (file) => JSON.parse(readFileSync(new URL(`../.workshop/${file}`, import.meta.url), "utf8"));
const project = read("project.json");
const roadmap = read("roadmap.json");
const progress = read("progress.json");
const tasks = roadmap.phases.flatMap((phase) => phase.tasks.map((task) => ({ ...task, phaseId: phase.id })));

const ids = process.argv.slice(2);
if (ids.length) {
  for (const id of ids) {
    const task = tasks.find((entry) => entry.id === id);
    console.log(task ? JSON.stringify(task, null, 2) : `${id}: nicht gefunden`);
  }
  process.exit(ids.every((id) => tasks.some((entry) => entry.id === id)) ? 0 : 1);
}

const counted = tasks.filter((task) => !["cancelled", "superseded"].includes(task.status));
const done = counted.filter((task) => task.status === "completed");
const weight = (list) => list.reduce((sum, task) => sum + (task.weight ?? 0), 0);
const overall = weight(counted) ? Math.round((weight(done) / weight(counted)) * 10000) / 100 : 0; // two decimals (DASHBOARD_CONTRACT.md)

console.log(`${project.name} (${project.status}) · Roadmap v${roadmap.roadmapVersion} (${roadmap.status})`);
console.log(`Fortschritt ${overall} % · Gewicht ${weight(done)}/${weight(counted)} · Tasks ${done.length}/${counted.length}`);
if (progress.overall !== overall || progress.completedWeight !== weight(done) || progress.totalWeight !== weight(counted) || progress.completedTasks !== done.length || progress.totalTasks !== counted.length) {
  console.log(`ABWEICHUNG progress.json: ${progress.overall} %, ${progress.completedWeight}/${progress.totalWeight}, ${progress.completedTasks}/${progress.totalTasks} – neu berechnen`);
}

console.log("\nPhasen");
for (const phase of roadmap.phases) {
  const own = phase.tasks.filter((task) => !["cancelled", "superseded"].includes(task.status));
  console.log(`  ${phase.id.padEnd(9)} ${String(phase.status).padEnd(11)} ${own.filter((task) => task.status === "completed").length}/${own.length}  ${phase.title}`);
}

const open = tasks.filter((task) => ["in_progress", "ready", "blocked", "planned"].includes(task.status));
console.log("\nOffene Tasks");
if (!open.length) console.log("  keine");
for (const task of open) {
  const deps = (task.dependsOn ?? []).filter((id) => tasks.find((entry) => entry.id === id)?.status !== "completed");
  console.log(`  ${task.id.padEnd(11)} ${task.status.padEnd(11)} ${task.title}${deps.length ? ` (wartet auf ${deps.join(", ")})` : ""}`);
}

console.log("\nZuletzt abgeschlossen");
for (const task of [...done].sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))).slice(0, 5)) {
  console.log(`  ${task.id.padEnd(11)} ${String(task.completedAt).slice(0, 10)}  ${task.title}`);
}
console.log("\nDetails eines Tasks: npm run workshop:status -- <task-id>");
