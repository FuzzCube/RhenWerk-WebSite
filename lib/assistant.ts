// Website assistant (task-18-10): checks of a question before it goes to n8n, and a simple limit per visitor.
// Pure functions, shared by app/api/assistant/route.ts and unit tests (tests/unit/assistant.test.mjs).

export const QUESTION_MAX = 500;
export const ANSWER_MAX = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AssistantRequest = { ok: true; question: string; sessionId: string } | { ok: false; message: string };

// Question 1–500 characters (whitespace collapsed), session_id a UUID of the browser tab (memory per visitor)
export function parseAssistantRequest(body: unknown): AssistantRequest {
  if (!body || typeof body !== "object") return { ok: false, message: "Ungültige Anfrage." };
  const { question, session_id: sessionId } = body as { question?: unknown; session_id?: unknown };
  if (typeof question !== "string") return { ok: false, message: "Bitte eine Frage eingeben." };
  const text = question.replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, message: "Bitte eine Frage eingeben." };
  if (text.length > QUESTION_MAX) return { ok: false, message: `Die Frage ist zu lang (höchstens ${QUESTION_MAX} Zeichen).` };
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) return { ok: false, message: "Ungültige Sitzung. Bitte die Seite neu laden." };
  return { ok: true, question: text, sessionId: sessionId.toLowerCase() };
}

// Answer of the workflow ({answer}) as plain text, shortened; null without a usable answer
export function assistantAnswer(body: unknown): string | null {
  const answer = (body as { answer?: unknown } | null)?.answer;
  if (typeof answer !== "string" || !answer.trim()) return null;
  return answer.trim().slice(0, ANSWER_MAX);
}

// At most `limit` requests per key within `windowMs` (in the memory of one server instance)
export function createRateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()): boolean => {
    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      if (windows.size > 10_000) for (const [entry, value] of windows) if (value.resetAt <= now) windows.delete(entry);
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    current.count += 1;
    return current.count > limit;
  };
}
