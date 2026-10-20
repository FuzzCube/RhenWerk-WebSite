// German description of audit events (request_events) for the history section.
import { formatDateTime, formatTimeRange } from "./format";
import { REMINDER_STAGES } from "./reminders";
import { label, statusInfo, type StatusKind } from "./status";

export const EVENT_LABELS: Record<string, string> = {
  submission_received: "Anfrage eingegangen",
  intake_status_changed: "Status der Erstbearbeitung geändert",
  intake_completed: "Erstbearbeitung abgeschlossen",
  dispatcher_assigned: "Dispatcher zugewiesen",
  technician_assigned: "Techniker zugewiesen",
  visit_scheduled: "Einsatz eingeplant",
  visit_rescheduled: "Einsatz verschoben",
  visit_reassigned: "Einsatz neu zugewiesen",
  visit_status_changed: "Einsatzstatus geändert",
  work_status_changed: "Arbeitsstatus geändert",
  work_completed: "Anfrage abgeschlossen",
  work_entry_added: "Arbeitsposition erfasst",
  work_entry_changed: "Arbeitsposition geändert",
  message_received: "Nachricht empfangen",
  message_linked: "Nachricht zugeordnet",
  request_created_from_message: "Anfrage aus E-Mail angelegt",
  request_created_by_phone: "Telefonische Anfrage angelegt",
  request_created_by_agent: "Anfrage vom Telefonassistenten angelegt",
  customer_linked: "Mit dem Kundenstamm verknüpft",
  customer_unlinked: "Verknüpfung mit dem Kundenstamm entfernt",
  // Automatic customer matching at the end of the intake (task-14-1); the value is the customer number
  customer_auto_created: "Kunde automatisch angelegt",
  customer_auto_linked: "Automatisch dem Kundenstamm zugeordnet",
  customer_suggested: "Möglicher Bestandskunde – bitte prüfen",
  customer_created_from_request: "Kunde aus der Anfrage angelegt",
  visit_hold_created: "Termin vom Telefonassistenten vorgemerkt",
  visit_hold_confirmed: "Vorgemerkter Termin bestätigt",
  visit_hold_rejected: "Vorgemerkten Termin abgelehnt",
  visit_hold_expired: "Terminvormerkung abgelaufen",
  callback_requested: "Rückrufbitte an den Techniker (Telefonassistent)",
  callback_acknowledged: "Rückruf bestätigt: Kunde angerufen",
  callback_escalated: "Rückruf nicht bestätigt: an den Dispatcher eskaliert",
  callback_closed_by_visit: "Rückrufbitte durch Einsatzbeginn erledigt",
  message_drafted: "E-Mail-Entwurf erstellt",
  message_queued: "E-Mail in Warteschlange gestellt",
  message_sent: "E-Mail-Versand bestätigt",
  invoice_created: "Rechnungsentwurf erstellt",
  invoice_issued: "Rechnung ausgestellt",
  invoice_sent: "Rechnung als versendet markiert",
  invoice_paid: "Zahlung erfasst",
  payment_reminder_queued: "Zahlungserinnerung erstellt",
  payment_reminders_paused: "Zahlungserinnerungen ausgesetzt",
  payment_reminders_resumed: "Zahlungserinnerungen fortgesetzt",
  automatic_result_corrected: "Automatisches Ergebnis korrigiert",
  analysis_corrected: "Analyse korrigiert",
  deadline_changed: "Frist geändert",
  note_added: "Notiz hinzugefügt",
};

const STATUS_OF_EVENT: Record<string, StatusKind> = {
  intake_status_changed: "intake_status",
  work_status_changed: "work_status",
  visit_status_changed: "visit_status",
  message_received: "message_status",
  message_queued: "message_status",
  message_sent: "message_status",
  message_drafted: "message_status",
  invoice_created: "invoice_status",
  invoice_issued: "invoice_status",
  invoice_sent: "invoice_status",
  invoice_paid: "invoice_status",
  work_entry_added: "work_item_status",
  work_entry_changed: "work_item_status",
};

const FIELD_LABELS: Record<string, string> = { priority: "Priorität", intake_status: "Erstbearbeitung", service_kind: "Leistungsart", equipment_kind: "Anlage" };

type EventLike = { event_type: string; from_value: string | null; to_value: string | null };

// "[2026-10-29T12:00:00Z,2026-10-29T15:00:00Z)" → formatted range
function formatRange(value: string): string | null {
  const match = /^[[(]"?([^,"]+)"?,"?([^,")\]]+)"?[)\]]$/.exec(value.trim());
  return match ? formatTimeRange(match[1], match[2]) : null;
}

// JSON objects of corrections: {"priority":"normal"} → "Priorität: Normal"
function formatObject(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return Object.entries(parsed as Record<string, unknown>)
      .map(([key, raw]) => {
        if (raw === null || raw === undefined || raw === "") return `${FIELD_LABELS[key] ?? key}: offen`;
        const text = String(raw);
        const shown = key === "priority" ? statusInfo("request_priority", text).label
          : key === "intake_status" ? statusInfo("intake_status", text).label
          : key === "service_kind" ? label("service_kind", text)
          : key === "equipment_kind" ? label("equipment_kind", text)
          : text;
        return `${FIELD_LABELS[key] ?? key}: ${shown}`;
      })
      .join(", ");
  } catch {
    return null;
  }
}

function formatValue(event: EventLike, value: string | null, names: Map<string, string>): string | null {
  if (value === null || value === "") return null;
  const kind = STATUS_OF_EVENT[event.event_type];
  if (kind) return statusInfo(kind, value).label;
  if (event.event_type === "dispatcher_assigned" || event.event_type === "technician_assigned" || event.event_type === "visit_reassigned") return names.get(value) ?? "Unbekannte Person";
  if (event.event_type === "intake_completed") return label("intake_mode", value);
  if (event.event_type.startsWith("visit_")) return formatRange(value) ?? value;
  if (event.event_type === "deadline_changed") return formatDateTime(value);
  if (event.event_type === "payment_reminder_queued") return REMINDER_STAGES[Number(value)] ?? value;
  if (value.startsWith("{")) return formatObject(value) ?? value;
  return value;
}

export function describeEvent(event: EventLike, names: Map<string, string>): { title: string; change: string | null } {
  const from = formatValue(event, event.from_value, names);
  const to = formatValue(event, event.to_value, names);
  const change = from && to ? (from === to ? to : `${from} → ${to}`) : to ?? (from ? `${from} → –` : null);
  return { title: EVENT_LABELS[event.event_type] ?? event.event_type, change };
}
