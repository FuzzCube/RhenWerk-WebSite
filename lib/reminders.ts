// Payment reminders (task-10-2): stage names and the short status text for list and request page.
// The stages and their due dates come from the view invoice_reminder_states (single source with the daily run).
import { formatCalendarDate } from "./format";

export const REMINDER_STAGES: Record<number, string> = { 1: "Zahlungserinnerung", 2: "1. Mahnung", 3: "2. Mahnung" };

export type ReminderState = {
  last_stage: number;
  last_reminder_at: string | null;
  paused: boolean;
  next_stage: number | null;
  next_due_on: string | null;
};

export const stageLabel = (stage: number | null | undefined) => (stage ? REMINDER_STAGES[stage] ?? `Stufe ${stage}` : "Keine");

// "2. Mahnung am 26.10.2026", "heute", "ausgesetzt" or null when nothing follows
export function nextReminderText(state: ReminderState | null | undefined, today: string): string | null {
  if (!state) return null;
  if (state.paused) return "Erinnerungen ausgesetzt";
  if (!state.next_stage || !state.next_due_on) return null;
  const when = state.next_due_on <= today ? "beim nächsten Lauf" : `am ${formatCalendarDate(state.next_due_on)}`;
  return `${stageLabel(state.next_stage)} ${when}`;
}

// Compact form for the invoice list: "Erinnerung", "1. Mahnung", "2. Mahnung" and "→ 1. Mahnung 26.10."
const SHORT_STAGES: Record<number, string> = { 1: "Erinnerung", 2: "1. Mahnung", 3: "2. Mahnung" };
export const shortStageLabel = (stage: number) => SHORT_STAGES[stage] ?? `Stufe ${stage}`;

export function nextReminderShort(state: ReminderState | null | undefined, today: string): string | null {
  if (!state) return null;
  if (state.paused) return "ausgesetzt";
  if (!state.next_stage || !state.next_due_on) return null;
  const [, month, day] = state.next_due_on.split("-");
  return `→ ${shortStageLabel(state.next_stage)} ${state.next_due_on <= today ? "fällig" : `${day}.${month}.`}`;
}
