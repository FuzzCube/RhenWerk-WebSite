import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { accessHeaders } from "@/lib/supabase/access";
import { createAdminClient } from "@/lib/supabase/admin";

// Health check (task-17-4) for monitors and the watchdog. Public: only
// {"status":"ok"} (200) or {"status":"fehler"} (503), because the route is reachable through the tunnel. With
// "Authorization: Bearer <HEALTH_TOKEN>" also commit, database and n8n with their duration. Only the database decides
// the status: without n8n the website and dashboard still work (the watchdog reports it, task-17-8).
const NO_STORE = { "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate" };
const TIMEOUT_MS = 3000;

type Check = { ok: boolean; ms: number; fehler?: string };

// Commit of the deployment (Vercel, task-18-4) or of a built release (release.json); "dev" in the development folder
function releaseCommit(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return (JSON.parse(readFileSync(path.join(process.cwd(), "release.json"), "utf8")) as { commit: string }).commit;
  } catch {
    return "dev";
  }
}

function authorized(request: Request): boolean {
  const token = process.env.HEALTH_TOKEN ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (!token || !header.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(token));
}

async function timed(run: (signal: AbortSignal) => Promise<string | null>): Promise<Check> {
  const started = performance.now();
  try {
    const failure = await run(AbortSignal.timeout(TIMEOUT_MS));
    const ms = Math.round(performance.now() - started);
    return failure ? { ok: false, ms, fehler: failure } : { ok: true, ms };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    return { ok: false, ms, fehler: error instanceof Error && error.name === "TimeoutError" ? "Zeitüberschreitung" : String(error instanceof Error ? error.message : error) };
  }
}

function checkDatabase(): Promise<Check> {
  return timed(async (signal) => {
    const { error } = await createAdminClient().from("system_status").select("id").limit(1).abortSignal(signal);
    return error ? error.message || "Datenbankfehler" : null;
  });
}

function checkN8n(): Promise<Check> | Check {
  const webhook = process.env.N8N_WEBHOOK_URL;
  if (!webhook) return { ok: false, ms: 0, fehler: "N8N_WEBHOOK_URL fehlt" };
  return timed(async (signal) => {
    const response = await fetch(new URL("/healthz", webhook), { headers: accessHeaders(), signal, cache: "no-store" });
    return response.ok ? null : `HTTP ${response.status}`;
  });
}

export async function GET(request: Request) {
  const [db, n8n] = await Promise.all([checkDatabase(), checkN8n()]);
  const status = db.ok ? "ok" : "fehler";
  const body = authorized(request) ? { status, commit: releaseCommit(), geprueft: new Date().toISOString(), db, n8n } : { status };
  return NextResponse.json(body, { status: db.ok ? 200 : 503, headers: NO_STORE });
}
