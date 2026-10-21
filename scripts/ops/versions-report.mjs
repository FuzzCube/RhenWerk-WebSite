// Versions for the area "System" (task-17-15) into system_status.dependency_updates; nightly run and "System prüfen"
import { rpc } from "./lib.mjs";
import { collectVersions, versionRows } from "./versions.mjs";

export async function refreshVersions() {
  const raw = await collectVersions();
  await rpc("set_system_status", { payload: { dependency_updates: { checked_at: new Date().toISOString(), versions: versionRows(raw) } } });
}
