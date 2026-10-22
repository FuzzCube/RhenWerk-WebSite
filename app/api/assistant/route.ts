import { NextResponse } from "next/server";
import { assistantAnswer, createRateLimiter, parseAssistantRequest } from "@/lib/assistant";
import { accessHeaders } from "@/lib/supabase/access";

// Website assistant (task-18-10): the browser asks here, the server forwards to the n8n workflow
// "RheinWerk · Assistent" with the Cloudflare Access service token (n8n is not public, no CORS). Limit: 20 questions
// per visitor (IP) in 10 minutes. N8N_ASSISTANT_URL, default /webhook/rheinwerk-assistant on the host of
// N8N_WEBHOOK_URL.
export const maxDuration = 60;

const limited = createRateLimiter(20, 10 * 60 * 1000);
const UNAVAILABLE = "Der Assistent ist momentan nicht erreichbar. Bitte versuchen Sie es später erneut.";

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function assistantUrl() {
  if (process.env.N8N_ASSISTANT_URL) return process.env.N8N_ASSISTANT_URL;
  return process.env.N8N_WEBHOOK_URL ? new URL("/webhook/rheinwerk-assistant", process.env.N8N_WEBHOOK_URL).toString() : null;
}

export async function POST(request: Request) {
  if (limited(clientIp(request))) {
    return NextResponse.json({ message: "Zu viele Fragen in kurzer Zeit. Bitte versuchen Sie es in einigen Minuten erneut." }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseAssistantRequest(body);
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });

  const url = assistantUrl();
  if (!url) return NextResponse.json({ message: UNAVAILABLE }, { status: 503 });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...accessHeaders() },
      body: JSON.stringify({ question: parsed.question, session_id: parsed.sessionId }),
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
    });
    const answer = response.ok ? assistantAnswer(await response.json().catch(() => null)) : null;
    if (!answer) return NextResponse.json({ message: UNAVAILABLE }, { status: 502 });
    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json({ message: UNAVAILABLE }, { status: 502 });
  }
}
