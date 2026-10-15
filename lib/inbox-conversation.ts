// Inbox conversations (task-12-3): state of a conversation and the reply template. Pure functions, usable in tests.

// new: nothing answered yet; queued/answered/failed: our latest reply; replied: the customer answered our reply
export type ConversationState = "new" | "queued" | "answered" | "failed" | "replied";
export type StateRow = { direction: string; status: string; received_at: string | null; created_at: string };

export const STATE_LABEL: Record<ConversationState, string | null> = {
  new: null,
  queued: "Antwort wird gesendet",
  answered: "Beantwortet · wartet auf Antwort",
  failed: "Versand fehlgeschlagen",
  replied: "Neue Antwort",
};

// State and last activity from the later messages of the conversation
export function conversationState(rootAt: string | null, later: ReadonlyArray<StateRow>): { state: ConversationState; last_at: string | null } {
  const at = (row: StateRow) => row.received_at ?? row.created_at;
  const sorted = [...later].sort((a, b) => at(a).localeCompare(at(b)));
  const last = sorted.at(-1);
  if (!last) return { state: "new", last_at: rootAt };
  const replied = sorted.some((row) => row.direction === "outgoing");
  if (last.direction === "incoming") return { state: replied ? "replied" : "new", last_at: at(last) };
  return { state: last.status === "sent" ? "answered" : last.status === "failed" ? "failed" : "queued", last_at: at(last) };
}

// "AW: <subject>" without stacking prefixes (AW, Re, Antwort)
export function replySubject(subject: string) {
  const base = subject.replace(/^\s*((aw|re|antwort|wg|fwd?)\s*:\s*)+/i, "").trim();
  return `AW: ${base || "Ihre Nachricht"}`.slice(0, 200);
}

// Question for the details needed to assign or create a request; signed with the sender's name
export function replyTemplate(senderName: string) {
  return [
    "Guten Tag,",
    "",
    "vielen Dank für Ihre Nachricht. Damit wir Ihr Anliegen zuordnen können, nennen Sie uns bitte:",
    "",
    "- Anfragenummer, falls vorhanden (z. B. RIS-2026-00123)",
    "- Firma und Standort der Anlage",
    "- Ansprechpartner mit Telefonnummer",
    "- Anlage und kurze Beschreibung des Anliegens",
    "",
    "Mit freundlichen Grüßen",
    senderName,
    "RheinWerk Industrieservice · Service Desk",
  ].join("\n");
}
