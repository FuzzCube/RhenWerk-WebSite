// Administration (task-8-1): pure helpers for forms and display. No database access; usable in tests.
import { MIN_PASSWORD_LENGTH } from "./auth/password";
import { addDays, berlinToInstant, isDayKey, isTime } from "./berlin-time";

export const WEEKDAYS = [
  { day: 1, label: "Montag", short: "Mo" },
  { day: 2, label: "Dienstag", short: "Di" },
  { day: 3, label: "Mittwoch", short: "Mi" },
  { day: 4, label: "Donnerstag", short: "Do" },
  { day: 5, label: "Freitag", short: "Fr" },
  { day: 6, label: "Samstag", short: "Sa" },
  { day: 7, label: "Sonntag", short: "So" },
] as const;

export const BILLING_MODEL_LABELS: Record<string, string> = { fixed: "Pauschal", hourly: "Nach Stunden" };

export const ASSIGNMENT_LABELS: Record<string, string> = {
  dispatcher: "Disposition der Anfrage",
  technician: "Zuständiger Techniker",
  visit: "Eingeplanter Einsatz",
};

// Company details on invoices (settings.company_details); other keys in the object are kept unchanged
export const COMPANY_FIELDS = [
  { key: "company_name", label: "Firma" },
  { key: "street_house_number", label: "Straße und Hausnummer" },
  { key: "postal_code", label: "PLZ" },
  { key: "city", label: "Ort" },
  { key: "phone", label: "Telefon" },
  { key: "email", label: "E-Mail" },
  { key: "managing_director", label: "Geschäftsführung" },
  { key: "vat_id", label: "USt-IdNr." },
  { key: "bank", label: "Bank" },
  { key: "iban", label: "IBAN" },
  { key: "legal_note", label: "Rechtlicher Hinweis" },
  { key: "invoice_note", label: "Hinweis auf der Rechnung" },
] as const;

export { MIN_PASSWORD_LENGTH };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WorkingHour = { weekday: number; local_start: string; local_end: string };

/** "19,5" or "19.5" → 19.5; empty or invalid → null */
export function parseDecimal(value: string | undefined): number | null {
  const text = (value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

// Weekly form: day_<n> = "on", day_<n>_start, day_<n>_end (HH:MM)
export function parseWorkingHours(values: Record<string, string>): { hours: WorkingHour[]; fieldErrors: Record<string, string> } {
  const hours: WorkingHour[] = [];
  const fieldErrors: Record<string, string> = {};
  for (const { day } of WEEKDAYS) {
    if (values[`day_${day}`] !== "on") continue;
    const start = values[`day_${day}_start`] ?? "";
    const end = values[`day_${day}_end`] ?? "";
    if (!isTime(start) || !isTime(end)) fieldErrors[`day_${day}_start`] = "Beginn und Ende im Format HH:MM angeben.";
    else if (end <= start) fieldErrors[`day_${day}_end`] = "Ende muss nach dem Beginn liegen.";
    else hours.push({ weekday: day, local_start: start, local_end: end });
  }
  return { hours, fieldErrors };
}

const hhmm = (time: string) => time.slice(0, 5);

// Compact weekly overview: consecutive days with the same window are grouped ("Mo–Fr 07:00–16:00")
export function summarizeWorkingHours(rows: Array<{ weekday: number | null; local_start: string | null; local_end: string | null }>): string {
  const byDay = new Map(rows.filter((row) => row.weekday && row.local_start && row.local_end)
    .map((row) => [row.weekday as number, `${hhmm(row.local_start as string)}–${hhmm(row.local_end as string)}`]));
  if (byDay.size === 0) return "Keine Arbeitszeiten";
  const groups: Array<{ from: number; to: number; window: string }> = [];
  for (const { day } of WEEKDAYS) {
    const window = byDay.get(day);
    if (!window) continue;
    const last = groups.at(-1);
    if (last && last.to === day - 1 && last.window === window) last.to = day;
    else groups.push({ from: day, to: day, window });
  }
  const short = (day: number) => WEEKDAYS[day - 1].short;
  return groups.map((group) => `${group.from === group.to ? short(group.from) : `${short(group.from)}–${short(group.to)}`} ${group.window}`).join(", ");
}

// Absence as whole local days: from 00:00 of the first day to 00:00 after the last day (Europe/Berlin)
export function absenceInterval(from: string | undefined, to: string | undefined): { starts_at: string; ends_at: string } | null {
  if (!isDayKey(from) || !isDayKey(to) || to < from) return null;
  return { starts_at: berlinToInstant(from, "00:00").toISOString(), ends_at: berlinToInstant(addDays(to, 1), "00:00").toISOString() };
}

export function validateNewEmployee(values: Record<string, string>, roles: readonly string[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  if (!values.display_name?.trim()) fieldErrors.display_name = "Bitte den Namen angeben.";
  if (!EMAIL.test(values.email?.trim() ?? "")) fieldErrors.email = "Bitte eine gültige E-Mail-Adresse angeben.";
  if (!roles.includes(values.role ?? "")) fieldErrors.role = "Bitte eine Rolle wählen.";
  if ((values.password ?? "").length < MIN_PASSWORD_LENGTH) fieldErrors.password = `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`;
  return fieldErrors;
}

// Company details from the settings form, merged into the stored object (unknown keys stay)
export function companyDetailsFrom(values: Record<string, string>, stored: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...stored };
  for (const { key } of COMPANY_FIELDS) {
    const text = values[`company_${key}`]?.trim() ?? "";
    if (text) result[key] = text;
    else delete result[key];
  }
  return result;
}
