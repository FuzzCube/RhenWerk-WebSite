import { addDays, berlinToInstant } from "./berlin-time";
import { hoursOn, type SlotWorkingHours } from "./slot-suggestions";

// Monthly load of a technician on the planning board (task-12-1): planned visit time within the working hours of
// the calendar month, divided by the working hours minus absences. Absences shorten the available time instead
// of counting as booked. Pure function, usable in tests.

export type LoadInterval = { technicianId: string; start: string; end: string };
export type MonthLoad =
  | { kind: "load"; percent: number; plannedMinutes: number; capacityMinutes: number; absentDays: number }
  | { kind: "absent"; absentDays: number }
  | { kind: "none" };

// All days of the month that contains the day ("2026-10-15" → 2026-10-01 … 2026-10-31)
export function monthDays(day: string): string[] {
  const first = `${day.slice(0, 8)}01`;
  const days: string[] = [];
  for (let current = first; current.slice(0, 7) === first.slice(0, 7); current = addDays(current, 1)) days.push(current);
  return days;
}

const overlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

// Minutes of [start, end) covered by the union of the intervals (overlapping intervals count once)
function coveredMinutes(start: number, end: number, intervals: ReadonlyArray<{ start: number; end: number }>) {
  const parts = intervals
    .map((interval) => ({ start: Math.max(start, interval.start), end: Math.min(end, interval.end) }))
    .filter((part) => part.end > part.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = start;
  for (const part of parts) {
    const from = Math.max(cursor, part.start);
    if (part.end > from) total += part.end - from;
    cursor = Math.max(cursor, part.end);
  }
  return total / 60000;
}

export function monthLoad(input: {
  technicianId: string;
  day: string;
  workingHours: readonly SlotWorkingHours[];
  visits: readonly LoadInterval[];
  absences: readonly LoadInterval[];
}): MonthLoad {
  const toRange = (list: readonly LoadInterval[]) => list
    .filter((item) => item.technicianId === input.technicianId)
    .map((item) => ({ start: Date.parse(item.start), end: Date.parse(item.end) }));
  const visits = toRange(input.visits);
  const absences = toRange(input.absences);
  let working = 0;
  let absent = 0;
  let planned = 0;
  let absentDays = 0;
  for (const day of monthDays(input.day)) {
    let dayWorking = 0;
    let dayAbsent = 0;
    for (const row of hoursOn(input.workingHours, input.technicianId, day)) {
      const from = berlinToInstant(day, row.start).getTime();
      const to = berlinToInstant(day, row.end).getTime();
      dayWorking += (to - from) / 60000;
      dayAbsent += coveredMinutes(from, to, absences);
      // Visit time only where the technician is not absent: covered by visits minus covered by both
      const free = coveredMinutes(from, to, visits);
      const both = coveredMinutes(from, to, visits.flatMap((visit) => absences
        .filter((absence) => overlap(visit.start, visit.end, absence.start, absence.end) > 0)
        .map((absence) => ({ start: Math.max(visit.start, absence.start), end: Math.min(visit.end, absence.end) }))));
      planned += free - both;
    }
    working += dayWorking;
    absent += dayAbsent;
    if (dayWorking > 0 && dayAbsent >= dayWorking) absentDays += 1;
  }
  const capacity = working - absent;
  if (working === 0) return { kind: "none" };
  if (capacity <= 0) return { kind: "absent", absentDays };
  return { kind: "load", percent: Math.round((planned / capacity) * 100), plannedMinutes: Math.round(planned), capacityMinutes: Math.round(capacity), absentDays };
}
