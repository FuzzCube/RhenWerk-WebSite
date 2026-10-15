// Unit tests for the monthly technician load on the planning board (task-12-1). Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { monthDays, monthLoad } from "../../lib/technician-load.ts";

const T = "tech-1";
// Mon–Fri 07:00–16:00 (9 h); October 2026 has 22 working days → 198 h = 11880 min
const hours = [1, 2, 3, 4, 5].map((weekday) => ({ technicianId: T, weekday, start: "07:00", end: "16:00", validFrom: null, validTo: null }));
const at = (day, time) => new Date(`${day}T${time}:00+02:00`).toISOString(); // CEST (October before the 25th)
const load = (visits = [], absences = []) => monthLoad({ technicianId: T, day: "2026-10-15", workingHours: hours, visits, absences });

test("Monatstage", () => {
  assert.equal(monthDays("2026-10-15").length, 31);
  assert.equal(monthDays("2026-02-03").at(-1), "2026-02-28");
  assert.equal(monthDays("2028-02-10").at(-1), "2028-02-29");
});

test("Arbeitszeit des Monats ohne Wochenenden, Einsätze anteilig", () => {
  const empty = load();
  assert.deepEqual(empty, { kind: "load", percent: 0, plannedMinutes: 0, capacityMinutes: 11880, absentDays: 0 });
  // 2 h on a Thursday, 3 h on a Saturday (outside working hours, not counted), other technician ignored
  const result = load([
    { technicianId: T, start: at("2026-10-15", "08:00"), end: at("2026-10-15", "10:00") },
    { technicianId: T, start: at("2026-10-17", "08:00"), end: at("2026-10-17", "11:00") },
    { technicianId: "other", start: at("2026-10-15", "08:00"), end: at("2026-10-15", "16:00") },
  ]);
  assert.equal(result.kind, "load");
  assert.equal(result.plannedMinutes, 120);
  assert.equal(result.percent, 1);
});

test("Abwesenheit mindert die Arbeitszeit statt als belegt zu zählen", () => {
  // Mon 19.10. – Fri 23.10. absent: 5 days less → 17 days × 9 h = 9180 min
  const week = [{ technicianId: T, start: at("2026-10-19", "00:00"), end: at("2026-10-24", "00:00") }];
  const visit = [{ technicianId: T, start: at("2026-10-14", "07:00"), end: at("2026-10-14", "16:00") }];
  const result = load(visit, week);
  assert.deepEqual(result, { kind: "load", percent: 6, plannedMinutes: 540, capacityMinutes: 9180, absentDays: 5 });
  // A visit inside the absence does not count twice
  const inside = load([{ technicianId: T, start: at("2026-10-20", "08:00"), end: at("2026-10-20", "10:00") }], week);
  assert.equal(inside.plannedMinutes, 0);
});

test("Ganzer Monat abwesend, keine Arbeitszeit", () => {
  const month = [{ technicianId: T, start: at("2026-09-30", "00:00"), end: new Date("2026-11-01T00:00:00+01:00").toISOString() }];
  assert.deepEqual(load([], month), { kind: "absent", absentDays: 22 });
  assert.deepEqual(monthLoad({ technicianId: "ohne", day: "2026-10-15", workingHours: hours, visits: [], absences: [] }), { kind: "none" });
});

test("Monatsgrenze und überlappende Einsätze", () => {
  // Visit 30.09. 15:00 – 01.10. 09:00: only 07:00–09:00 on 01.10. counts; overlapping visits count once
  const result = load([
    { technicianId: T, start: at("2026-09-30", "15:00"), end: at("2026-10-01", "09:00") },
    { technicianId: T, start: at("2026-10-01", "08:00"), end: at("2026-10-01", "10:00") },
  ]);
  assert.equal(result.plannedMinutes, 180);
});
