// One displayed status per request and per invoice (design rework task-10-3, specification section 04).
// The tone says who has to move: act = we must act, run = proceeds as planned, wait = we wait for
// others, done = finished, closed = rejected or cancelled. The label alone is always sufficient.
import { addDays } from "./berlin-time";

export type DisplayTone = "act" | "run" | "wait" | "done" | "closed";
export type DisplayStatus = { key: string; label: string; tone: DisplayTone };

const INTAKE: Record<string, DisplayStatus> = {
  new: { key: "neu", label: "Neu", tone: "act" },
  analyzing: { key: "analyse", label: "Analyse", tone: "run" },
  needs_review: { key: "pruefung", label: "Prüfung", tone: "act" },
  awaiting_customer: { key: "wartet_kunde", label: "Wartet auf Kunde", tone: "wait" },
  rejected: { key: "abgelehnt", label: "Abgelehnt", tone: "closed" },
  cancelled: { key: "storniert", label: "Storniert", tone: "closed" },
};

const WORK: Record<string, DisplayStatus> = {
  not_planned: { key: "zu_planen", label: "Zu planen", tone: "run" },
  scheduled: { key: "eingeplant", label: "Eingeplant", tone: "run" },
  in_progress: { key: "in_arbeit", label: "In Arbeit", tone: "run" },
  waiting_parts: { key: "wartet_teile", label: "Wartet auf Teile", tone: "wait" },
  completed: { key: "abgeschlossen", label: "Abgeschlossen", tone: "done" },
  cancelled: { key: "storniert", label: "Storniert", tone: "closed" },
};

const UNKNOWN: DisplayStatus = { key: "unbekannt", label: "Unbekannt", tone: "wait" };

// Until the initial processing is finished its status is shown; afterwards the work status.
// Combinations the specification does not list (e.g. review + scheduled) also fall back to the
// initial processing (user decision 08.10.2026). A cancelled request is cancelled in any case.
export function requestDisplayStatus(intakeStatus: string | null | undefined, workStatus: string | null | undefined): DisplayStatus {
  if (workStatus === "cancelled" && intakeStatus !== "rejected") return WORK.cancelled;
  if (intakeStatus === "processed") return (workStatus && WORK[workStatus]) || UNKNOWN;
  return (intakeStatus && INTAKE[intakeStatus]) || UNKNOWN;
}

// All displayed request statuses in workflow order (filters, legends)
export const REQUEST_DISPLAY_STATUSES: readonly DisplayStatus[] = [
  INTAKE.new, INTAKE.analyzing, INTAKE.needs_review, INTAKE.awaiting_customer,
  WORK.not_planned, WORK.scheduled, WORK.in_progress, WORK.waiting_parts, WORK.completed,
  INTAKE.rejected, WORK.cancelled,
];

// Database filter of a displayed status as PostgREST "or" expression (exact inverse of
// requestDisplayStatus); null for unknown keys
export function requestStatusFilter(key: string): string | null {
  if (key === "storniert") return "intake_status.eq.cancelled,and(work_status.eq.cancelled,intake_status.neq.rejected)";
  if (key === "abgelehnt") return "intake_status.eq.rejected";
  const intake = Object.entries(INTAKE).find(([, status]) => status.key === key);
  if (intake) return `and(intake_status.eq.${intake[0]},work_status.neq.cancelled)`;
  const work = Object.entries(WORK).find(([, status]) => status.key === key);
  if (work) return `and(intake_status.eq.processed,work_status.eq.${work[0]})`;
  return null;
}

// "Open" in the priority column means not yet determined, shown muted
export function priorityDisplay(priority: string | null | undefined): { label: string; determined: boolean } {
  const labels: Record<string, string> = { low: "Niedrig", normal: "Normal", high: "Hoch", critical: "Kritisch" };
  return priority && labels[priority] ? { label: labels[priority], determined: true } : { label: "nicht bestimmt", determined: false };
}

export type InvoiceDisplayStatus = DisplayStatus & { overdueDays: number | null; dueInDays: number | null };

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

// Invoice status on a local calendar day (Berlin). An unpaid invoice past its due date is overdue,
// whether it was marked as sent or not; the chip then says "Überfällig", the detail "seit N Tagen".
export function invoiceDisplayStatus(status: string | null | undefined, paymentDueDate: string | null | undefined, today: string): InvoiceDisplayStatus {
  const open = status === "issued" || status === "sent";
  const overdue = open && paymentDueDate ? Math.max(0, dayDiff(paymentDueDate, today)) : 0;
  const dueIn = open && paymentDueDate && overdue === 0 ? dayDiff(today, paymentDueDate) : null;
  if (open && overdue > 0) return { key: "ueberfaellig", label: "Überfällig", tone: "act", overdueDays: overdue, dueInDays: null };
  switch (status) {
    case "draft": return { key: "entwurf", label: "Entwurf", tone: "wait", overdueDays: null, dueInDays: null };
    case "issued": return { key: "ausgestellt", label: "Ausgestellt · nicht versendet", tone: "run", overdueDays: null, dueInDays: dueIn };
    case "sent": return { key: "versendet", label: "Versendet · offen", tone: "run", overdueDays: null, dueInDays: dueIn };
    case "paid": return { key: "bezahlt", label: "Bezahlt", tone: "done", overdueDays: null, dueInDays: null };
    default: return { ...UNKNOWN, overdueDays: null, dueInDays: null };
  }
}

/** "seit 1 Tag" · "seit 9 Tagen" */
export function overdueText(days: number): string {
  return days === 1 ? "seit 1 Tag" : `seit ${days} Tagen`;
}

// Latest due date that still counts as "bald fällig" (specification section 07: ≤ 7 days)
export function dueSoonLimit(today: string): string {
  return addDays(today, 7);
}

export type ProgressStep = { label: string; state: "done" | "current" | "todo" };

const PROGRESS = ["Eingang", "Analyse", "Prüfung", "Einsatzplanung", "Einsatz", "Abschluss"];

// Progress of a request on the detail page. Rejected and cancelled requests have no progress (null);
// a completed request has all steps done.
export function requestProgress(intakeStatus: string | null | undefined, workStatus: string | null | undefined): ProgressStep[] | null {
  const status = requestDisplayStatus(intakeStatus, workStatus);
  if (status.tone === "closed" || status.key === "unbekannt") return null;
  const current: Record<string, number> = {
    neu: 0, analyse: 1, pruefung: 2, wartet_kunde: 2, zu_planen: 3, eingeplant: 4, in_arbeit: 4, wartet_teile: 4, abgeschlossen: PROGRESS.length,
  };
  const index = current[status.key] ?? 0;
  return PROGRESS.map((label, step) => ({ label, state: step < index ? "done" : step === index ? "current" : "todo" }));
}

export const AGING_BUCKETS = [
  { key: "1-30", label: "1–30 Tage", min: 1, max: 30 },
  { key: "31-60", label: "31–60 Tage", min: 31, max: 60 },
  { key: "61-90", label: "61–90 Tage", min: 61, max: 90 },
  { key: "90+", label: "über 90 Tage", min: 91, max: Infinity },
] as const;

// Overdue open invoices by days past due (Rechnungen, "Überfällig nach Alter"); amounts in cents-exact sums
export function overdueAging(rows: ReadonlyArray<{ status: string; payment_due_date: string | null; total: number }>, today: string) {
  const buckets = AGING_BUCKETS.map((bucket) => ({ ...bucket, count: 0, total: 0 }));
  for (const row of rows) {
    const shown = invoiceDisplayStatus(row.status, row.payment_due_date, today);
    if (shown.overdueDays === null) continue;
    const bucket = buckets.find((entry) => shown.overdueDays! >= entry.min && shown.overdueDays! <= entry.max)!;
    bucket.count += 1;
    bucket.total = Math.round((bucket.total + Number(row.total)) * 100) / 100;
  }
  return buckets;
}

// Why the automation is working on a request right now (task-24-1, view request_automation_pending)
export type AutomationReason = "analyse" | "antwort";
