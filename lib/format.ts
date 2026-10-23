// de-DE formatting in Europe/Berlin. Usable on server and client; the result does not depend on the
// server's time zone, so server and client render identical text.
export const LOCALE = "de-DE";
export const TIME_ZONE = "Europe/Berlin";
export const EMPTY = "–";

type DateInput = Date | string | number | null | undefined;
type NumberInput = number | string | null | undefined;

const dateFormat = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const weekdayDateFormat = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
// Calendar dates (Postgres "date", e.g. requested_visit_date) carry no time zone and must not shift
const plainDateFormat = new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value: NumberInput): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 07.10.2026 */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  return date ? dateFormat.format(date) : EMPTY;
}

/** 07.10.2026, 14:30 */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  return date ? dateTimeFormat.format(date) : EMPTY;
}

/** 14:30 */
export function formatTime(value: DateInput): string {
  const date = toDate(value);
  return date ? timeFormat.format(date) : EMPTY;
}

/** Mi., 07.10.2026 */
export function formatWeekdayDate(value: DateInput): string {
  const date = toDate(value);
  return date ? weekdayDateFormat.format(date) : EMPTY;
}

/** Mi., 07.10.2026, 08:00–10:00 (same day) or two full date-times */
export function formatTimeRange(start: DateInput, end: DateInput): string {
  const from = toDate(start);
  const to = toDate(end);
  if (!from || !to) return EMPTY;
  if (berlinDayKey(from) === berlinDayKey(to)) return `${formatWeekdayDate(from)}, ${formatTime(from)}–${formatTime(to)}`;
  return `${formatDateTime(from)} – ${formatDateTime(to)}`;
}

/** Postgres date "2026-10-07" → 07.10.2026 without time zone shift */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return EMPTY;
  return plainDateFormat.format(new Date(`${value}T00:00:00Z`));
}

const WISHED_TIME: Record<string, string> = { any: "Uhrzeit beliebig", morning: "vormittags", afternoon: "nachmittags" };

/** Wished appointment from the website form (task-19-3): "Fr., 24.10.2026, 10:00 Uhr" or "Fr., 24.10.2026, vormittags" */
export function formatWish(day: string | null | undefined, time: string | null | undefined): string {
  const date = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatWeekdayDate(`${day}T12:00:00Z`) : EMPTY;
  const wished = time || "any";
  return `${date}, ${WISHED_TIME[wished] ?? `${wished} Uhr`}`;
}

/** Day in Berlin as YYYY-MM-DD, e.g. for grouping by day */
export function berlinDayKey(value: DateInput): string {
  const date = toDate(value);
  return date ? dayKeyFormat.format(date) : "";
}

/** 1.234,50 € */
export function formatCurrency(value: NumberInput, currency = "EUR"): string {
  const number = toNumber(value);
  if (number === null) return EMPTY;
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency }).format(number);
}

/** 1.234,5 */
export function formatNumber(value: NumberInput, fractionDigits = 0): string {
  const number = toNumber(value);
  if (number === null) return EMPTY;
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(number);
}

/** Value in percent points: 84 → 84,0 % */
export function formatPercent(value: NumberInput, fractionDigits = 1): string {
  const number = toNumber(value);
  if (number === null) return EMPTY;
  return `${formatNumber(number, fractionDigits)} %`;
}

/** 1500 → 25 h 0 min; 45 → 45 min */
export function formatMinutes(value: NumberInput): string {
  const number = toNumber(value);
  if (number === null) return EMPTY;
  const total = Math.round(number);
  const sign = total < 0 ? "−" : "";
  const minutes = Math.abs(total);
  if (minutes < 60) return `${sign}${minutes} min`;
  return `${sign}${formatNumber(Math.floor(minutes / 60))} h ${minutes % 60} min`;
}

/** Elapsed time for waiting periods: 45 min, 3 h 20 min, 2 T 4 h */
export function formatElapsed(minutes: NumberInput): string {
  const number = toNumber(minutes);
  if (number === null || number < 0) return EMPTY;
  const total = Math.floor(number);
  if (total < 60) return `${total} min`;
  if (total < 1440) return `${Math.floor(total / 60)} h ${total % 60} min`;
  return `${Math.floor(total / 1440)} T ${Math.floor((total % 1440) / 60)} h`;
}
