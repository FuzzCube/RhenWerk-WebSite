// German labels and display tones for database enums. A status is always shown as text;
// the tone only adds color, so no information depends on color alone.
export type StatusTone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";
type StatusMap = Record<string, { label: string; tone: StatusTone }>;

export const STATUS = {
  intake_status: {
    new: { label: "Neu", tone: "info" },
    analyzing: { label: "In Analyse", tone: "progress" },
    needs_review: { label: "Prüfung erforderlich", tone: "warning" },
    awaiting_customer: { label: "Wartet auf Kunde", tone: "neutral" },
    processed: { label: "Erstbearbeitung abgeschlossen", tone: "success" },
    rejected: { label: "Abgelehnt", tone: "danger" },
    cancelled: { label: "Storniert", tone: "neutral" },
  },
  work_status: {
    not_planned: { label: "Nicht eingeplant", tone: "warning" },
    scheduled: { label: "Eingeplant", tone: "info" },
    in_progress: { label: "In Arbeit", tone: "progress" },
    waiting_parts: { label: "Wartet auf Teile", tone: "warning" },
    completed: { label: "Abgeschlossen", tone: "success" },
    cancelled: { label: "Storniert", tone: "neutral" },
  },
  visit_status: {
    scheduled: { label: "Geplant", tone: "info" },
    in_progress: { label: "Läuft", tone: "progress" },
    waiting_parts: { label: "Wartet auf Teile", tone: "warning" },
    completed: { label: "Erledigt", tone: "success" },
    cancelled: { label: "Storniert", tone: "neutral" },
  },
  invoice_status: {
    draft: { label: "Entwurf", tone: "neutral" },
    issued: { label: "Ausgestellt", tone: "info" },
    sent: { label: "Als versendet markiert", tone: "progress" },
    paid: { label: "Bezahlt", tone: "success" },
  },
  // "queued" is not a confirmed send; only "sent" is confirmed by the integration
  message_status: {
    draft: { label: "Entwurf", tone: "neutral" },
    queued: { label: "In Warteschlange, nicht versendet", tone: "info" },
    sent: { label: "Versand bestätigt", tone: "success" },
    received: { label: "Empfangen", tone: "info" },
    failed: { label: "Versand fehlgeschlagen", tone: "danger" },
  },
  work_item_status: {
    planned: { label: "Geplant", tone: "neutral" },
    ordered: { label: "Bestellt", tone: "warning" },
    performed: { label: "Ausgeführt", tone: "success" },
    used: { label: "Verbaut", tone: "success" },
    cancelled: { label: "Storniert", tone: "neutral" },
  },
  request_priority: {
    low: { label: "Niedrig", tone: "neutral" },
    normal: { label: "Normal", tone: "info" },
    high: { label: "Hoch", tone: "warning" },
    critical: { label: "Kritisch", tone: "danger" },
  },
  automation_status: {
    running: { label: "Läuft", tone: "progress" },
    succeeded: { label: "Erfolgreich", tone: "success" },
    failed: { label: "Fehlgeschlagen", tone: "danger" },
  },
  profile_active: {
    true: { label: "Aktiv", tone: "success" },
    false: { label: "Deaktiviert", tone: "neutral" },
  },
} as const satisfies Record<string, StatusMap>;

export type StatusKind = keyof typeof STATUS;

export function statusInfo(kind: StatusKind, value: string | null | undefined): { label: string; tone: StatusTone } {
  const map: StatusMap = STATUS[kind];
  if (value === null || value === undefined) return { label: "Unbekannt", tone: "neutral" };
  return map[value] ?? { label: value, tone: "neutral" };
}

// Plain labels for enums without status character
export const LABELS = {
  service_kind: { inspection: "Inspektion", scheduled_maintenance: "Planmäßige Wartung", diagnosis_repair: "Diagnose und Reparatur" },
  equipment_kind: { pump: "Pumpe", compressor: "Kompressor", ventilation: "Lüftungsanlage", other: "Sonstige Anlage" },
  customer_urgency: { planbar: "Planbar", zeitnah: "Zeitnah", erheblich: "Erheblich", production_stop: "Produktionsstillstand" },
  safety_risk: { none_known: "Keine bekannt", known: "Bekannt", unclear: "Unklar" },
  intake_mode: { automatic: "Automatisch", manual: "Manuell", human_review: "Mit menschlicher Prüfung" },
  work_entry_kind: { labor: "Arbeitszeit", part: "Material", fixed_service: "Pauschale" },
  work_unit: { hour: "Std.", piece: "Stk.", service: "Pauschale" },
  visibility_level: { operational: "Technik", dispatch: "Disposition", management: "Leitung" },
  automation_step: { intake_analysis: "Analyse der Anfrage", reply_analysis: "Analyse der Kundenantwort", email_matching: "E-Mail-Zuordnung", email_send: "E-Mail-Versand", visit_reply: "Kundenantwort zum Termin", reply_assist: "Antwortassistent" },
  automation_decision: { ready_for_planning: "Bereit zur Planung", ask_customer: "Rückfrage an Kunden", human_review: "Menschliche Prüfung", matched: "Zugeordnet", unmatched: "Nicht zugeordnet", sent: "Versendet" },
  // Channel of a request; demo requests stand for the website form
  request_source: { website_form: "Website-Formular", demo_seed: "Website-Formular", email: "E-Mail", phone: "Telefon", phone_agent: "Telefon (KI)" },
  call_category: { neue_anfrage: "Neue Anfrage", termin: "Termin", status: "Status", verspaetung: "Verspätung", frage: "Frage", notfall: "Notfall", beschwerde: "Beschwerde", ausserhalb_gebiet: "Außerhalb des Gebiets", spam: "Spam", sonstiges: "Sonstiges" },
  call_sentiment: { positiv: "Positiv", neutral: "Neutral", negativ: "Negativ" },
} as const satisfies Record<string, Record<string, string>>;

export function label(kind: keyof typeof LABELS, value: string | null | undefined): string {
  const map: Record<string, string> = LABELS[kind];
  if (!value) return "–";
  return map[value] ?? value;
}
