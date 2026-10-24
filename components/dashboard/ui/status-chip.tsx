import { overdueText, priorityDisplay, requestDisplayStatus, type AutomationReason, type DisplayStatus, type InvoiceDisplayStatus } from "@/lib/display-status";
import { Icon } from "@/components/ui";

// One status chip per request or invoice (specification section 04). The tone says who has to move;
// the label alone is sufficient (also for screen readers and print).
export function StatusChip({ status }: { status: DisplayStatus }) {
  return (
    <span className={`rw-chip rw-chip--${status.tone}`}>
      <span className="rw-chip__dot" aria-hidden="true" />
      {status.label}
    </span>
  );
}

export function RequestStatusChip({ intakeStatus, workStatus }: { intakeStatus: string | null; workStatus: string | null }) {
  return <StatusChip status={requestDisplayStatus(intakeStatus, workStatus)} />;
}

// task-24-1: the automation works on the request in the background (analysis, or workflow 13/14 on a customer reply)
export function AutomationBusy({ reason }: { reason: AutomationReason }) {
  return (
    <span className="rw-chip rw-chip--run rw-chip--busy" role="status" data-automation={reason}
      title={reason === "analyse" ? "Die Anfrage wird automatisch ausgewertet" : "Die Kundenantwort wird automatisch ausgewertet, ein Antwortentwurf folgt"}>
      <span className="rw-chip__spinner" aria-hidden="true" />
      KI arbeitet …
    </span>
  );
}

// Overdue invoices: chip "Überfällig", below it "seit N Tagen"
export function InvoiceStatusChip({ status }: { status: InvoiceDisplayStatus }) {
  return (
    <span className="rw-chip-stack">
      <StatusChip status={status} />
      {status.overdueDays !== null && <span className="rw-chip-stack__detail">{overdueText(status.overdueDays)}</span>}
    </span>
  );
}

// Priority: critical and high as chip, normal and low as text, missing as muted "nicht bestimmt"
export function PriorityText({ priority }: { priority: string | null }) {
  const { label, determined } = priorityDisplay(priority);
  if (!determined) return <span className="rw-priority rw-priority--none">{label}</span>;
  return <span className={`rw-priority rw-priority--${priority}`}>{label}</span>;
}

// Safety risk of a request: known or unclear hazards are flagged, "none known" shows nothing
export function HazardFlag({ risk }: { risk: string | null }) {
  if (risk !== "known" && risk !== "unclear") return null;
  return (
    <span className="rw-hazard">
      <Icon name="hazard" size={14} />
      Gefahr: {risk === "known" ? "Bekannt" : "Unklar"}
    </span>
  );
}
