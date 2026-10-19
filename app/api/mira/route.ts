import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import agentConfig from "@/docs/telefonassistent/elevenlabs.json";
import { MIRA_DAILY_SECONDS, MIRA_MAX_SECONDS, MIRA_PER_CLIENT_HOUR, type MiraBudget, type MiraStart } from "@/lib/mira-widget";
import { createAdminClient } from "@/lib/supabase/admin";

// Web widget "Mit Mira sprechen" (task-13-8). The agent in ElevenLabs only accepts signed URLs, so every
// conversation starts here: GET shows the remaining day budget, POST reserves a session (database: 3 minutes per
// conversation, 10 minutes per day, 3 sessions per client and hour) and returns a signed URL, PATCH stores the
// conversation of a session so the real duration counts once it is evaluated.
const NO_STORE = { "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Agent of npm run agent:sync; ELEVENLABS_AGENT_ID overrides it (e.g. a separate demo agent)
function agentId(): string | null {
  return process.env.ELEVENLABS_AGENT_ID ?? agentConfig.agent_id ?? null;
}

// Salted hash of the client address; the address itself is never stored
function clientKey(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unbekannt";
  const salt = process.env.MIRA_WIDGET_SALT ?? process.env.SUPABASE_SECRET_KEY ?? "";
  return createHash("sha256").update(`${salt}:mira:${ip}`).digest("hex");
}

// Only the own pages may start a conversation (another site could otherwise use up the budget)
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function GET() {
  const { data, error } = await createAdminClient().rpc("widget_budget", { daily_seconds: MIRA_DAILY_SECONDS, max_seconds: MIRA_MAX_SECONDS });
  const budget = data as { verfuegbar?: boolean; rest_sekunden?: number } | null;
  const body: MiraBudget = error || !budget ? { verfuegbar: false, restMinuten: 0 } : { verfuegbar: budget.verfuegbar === true, restMinuten: Math.floor((budget.rest_sekunden ?? 0) / 60) };
  return NextResponse.json(body, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const reply = (body: MiraStart, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
  if (!sameOrigin(request)) return reply({ ok: false, grund: "herkunft" }, 403);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agent = agentId();
  if (!apiKey || !agent) return reply({ ok: false, grund: "stoerung" }, 503);

  const { data, error } = await createAdminClient().rpc("widget_session_start", {
    client_key: clientKey(request), max_seconds: MIRA_MAX_SECONDS, daily_seconds: MIRA_DAILY_SECONDS, per_client_hour: MIRA_PER_CLIENT_HOUR,
  });
  const session = data as { ok?: boolean; grund?: string; sitzung_id?: string } | null;
  if (error || !session) return reply({ ok: false, grund: "stoerung" }, 503);
  if (!session.ok) return reply({ ok: false, grund: session.grund === "zu_viele" ? "zu_viele" : "tageslimit" }, 429);

  const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agent)}`, {
    headers: { "xi-api-key": apiKey }, cache: "no-store", signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const signed = response?.ok ? ((await response.json()) as { signed_url?: string }).signed_url : undefined;
  if (!signed) return reply({ ok: false, grund: "stoerung" }, 503);
  return reply({ ok: true, signedUrl: signed, sessionId: session.sitzung_id!, maxSeconds: MIRA_MAX_SECONDS });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { sessionId?: unknown; conversationId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId.slice(0, 100) : "";
  if (!UUID.test(sessionId) || !conversationId) return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE });
  const { data, error } = await createAdminClient().rpc("widget_session_bind", { session_id: sessionId, conversation_id: conversationId });
  return NextResponse.json({ ok: !error && data === true }, { headers: NO_STORE });
}
