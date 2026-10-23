// Unit tests for de-DE formatting in Europe/Berlin and the status/form helpers.
// Run with: npm run test:unit   (Node strips the TypeScript types of the imported modules)
import assert from "node:assert/strict";
import { test } from "node:test";
import { berlinDayKey, formatCalendarDate, formatCurrency, formatDate, formatDateTime, formatMinutes, formatNumber, formatPercent, formatTime, formatTimeRange, formatWish, EMPTY } from "../../lib/format.ts";
import { databaseErrorMessage, formError, formValues } from "../../lib/forms.ts";
import { label, statusInfo, STATUS } from "../../lib/status.ts";

const nbsp = (text) => text.replace(/ | /g, " ");

test("Datum und Uhrzeit in Europe/Berlin, unabhängig von der Server-Zeitzone", () => {
  assert.equal(formatDateTime("2026-10-07T12:30:00Z"), "07.10.2026, 14:30"); // Sommerzeit UTC+2
  assert.equal(formatDateTime("2026-01-15T12:30:00Z"), "15.01.2026, 13:30"); // Winterzeit UTC+1
  assert.equal(formatDate("2026-03-28T23:30:00Z"), "29.03.2026"); // UTC-Vortag, in Berlin schon der 29.
  assert.equal(formatTime("2026-10-25T00:30:00Z"), "02:30"); // Tag der Zeitumstellung, noch Sommerzeit
  assert.equal(formatTime("2026-10-25T01:30:00Z"), "02:30"); // nach Rückstellung, Winterzeit
  assert.equal(berlinDayKey("2026-12-31T23:30:00Z"), "2027-01-01");
});

test("Zeiträume", () => {
  assert.equal(formatTimeRange("2026-10-07T06:00:00Z", "2026-10-07T08:30:00Z"), "Mi., 07.10.2026, 08:00–10:30");
  assert.equal(formatTimeRange("2026-10-07T20:00:00Z", "2026-10-08T06:00:00Z"), "07.10.2026, 22:00 – 08.10.2026, 08:00");
});

test("Kalenderdatum ohne Zeitzonenverschiebung", () => {
  assert.equal(formatCalendarDate("2026-12-24"), "24.12.2026");
  assert.equal(formatCalendarDate("24.12.2026"), EMPTY);
});

test("Beträge, Zahlen, Anteile und Dauer", () => {
  assert.equal(nbsp(formatCurrency(12345.6)), "12.345,60 €");
  assert.equal(nbsp(formatCurrency("95.00")), "95,00 €");
  assert.equal(nbsp(formatCurrency(-19)), "-19,00 €");
  assert.equal(formatNumber(1234.5, 1), "1.234,5");
  assert.equal(nbsp(formatPercent(84)), "84,0 %");
  assert.equal(formatMinutes(1500), "25 h 0 min");
  assert.equal(formatMinutes(45), "45 min");
  assert.equal(formatMinutes(125), "2 h 5 min");
});

test("Leere und ungültige Werte", () => {
  for (const value of [null, undefined, "", "kein Datum"]) {
    assert.equal(formatDate(value), EMPTY);
    assert.equal(formatDateTime(value), EMPTY);
  }
  assert.equal(formatCurrency(null), EMPTY);
  assert.equal(formatMinutes("x"), EMPTY);
});

test("Jeder Status hat Text und Ton; unbekannte Werte bleiben lesbar", () => {
  for (const [kind, map] of Object.entries(STATUS)) {
    for (const [value, info] of Object.entries(map)) {
      assert.ok(info.label.length > 0, `${kind}.${value}`);
      assert.deepEqual(statusInfo(kind, value), info);
    }
  }
  assert.deepEqual(statusInfo("intake_status", "unbekannt"), { label: "unbekannt", tone: "neutral" });
  assert.match(statusInfo("message_status", "queued").label, /nicht versendet/);
  assert.equal(label("service_kind", "diagnosis_repair"), "Diagnose und Reparatur");
});

test("Formularhilfen erhalten Eingaben und übersetzen Datenbankfehler", () => {
  const data = new FormData();
  data.append("$ACTION_ID_abc", "");
  data.append("company", "Muster GmbH");
  data.append("hours", "1,5");
  const values = formValues(data);
  assert.deepEqual(values, { company: "Muster GmbH", hours: "1,5" });
  const state = formError("Fehler", values, { hours: "falsch" });
  assert.equal(state.status, "error");
  assert.deepEqual(state.values, values);
  assert.match(databaseErrorMessage({ code: "RW409" }), /inzwischen .* geändert/);
  assert.equal(databaseErrorMessage({ code: "RW422", message: "Ablehnung ist nur vor Arbeitsbeginn möglich" }), "Ablehnung ist nur vor Arbeitsbeginn möglich");
  assert.match(databaseErrorMessage({ code: "42501" }), /Keine Berechtigung/);
  assert.match(databaseErrorMessage({ code: "XX000", message: "intern" }), /Speichern fehlgeschlagen/);
});

test("Verlauf: Ereignisse verständlich beschreiben", async () => {
  const { describeEvent } = await import("../../lib/events.ts");
  const names = new Map([["u1", "Lea Schneider"]]);
  assert.deepEqual(describeEvent({ event_type: "intake_status_changed", from_value: "analyzing", to_value: "processed" }, names), { title: "Status der Erstbearbeitung geändert", change: "In Analyse → Erstbearbeitung abgeschlossen" });
  assert.equal(describeEvent({ event_type: "dispatcher_assigned", from_value: null, to_value: "u1" }, names).change, "Lea Schneider");
  assert.equal(describeEvent({ event_type: "visit_scheduled", from_value: null, to_value: "[2026-10-29T12:00:00.000Z,2026-10-29T15:00:00.000Z)" }, names).change, "Do., 29.10.2026, 13:00–16:00");
  assert.equal(describeEvent({ event_type: "automatic_result_corrected", from_value: '{"priority":"normal"}', to_value: '{"priority":"high"}' }, names).change, "Priorität: Normal → Priorität: Hoch");
  assert.equal(describeEvent({ event_type: "message_queued", from_value: "draft", to_value: "queued" }, names).change, "Entwurf → In Warteschlange, nicht versendet");
  assert.deepEqual(describeEvent({ event_type: "customer_auto_created", from_value: null, to_value: "K-20001" }, names), { title: "Kunde automatisch angelegt", change: "K-20001" });
  assert.equal(describeEvent({ event_type: "customer_suggested", from_value: null, to_value: "K-10420, K-10421" }, names).title, "Möglicher Bestandskunde – bitte prüfen");
  assert.deepEqual(describeEvent({ event_type: "unbekannt", from_value: null, to_value: null }, names), { title: "unbekannt", change: null });
});

test("Verlauf: leere Werte in Korrekturen als „offen“", async () => {
  const { describeEvent } = await import("../../lib/events.ts");
  assert.equal(describeEvent({ event_type: "analysis_corrected", from_value: '{"priority":null,"service_kind":"inspection"}', to_value: '{"priority":"high","service_kind":"inspection"}' }, new Map()).change, "Priorität: offen, Leistungsart: Inspektion → Priorität: Hoch, Leistungsart: Inspektion");
});

test("Berliner Kalenderarithmetik für die Einsatzplanung", async () => {
  const t = await import("../../lib/berlin-time.ts");
  assert.equal(t.weekStart("2026-10-07"), "2026-10-05");
  assert.equal(t.weekStart("2026-10-11"), "2026-10-05");
  assert.equal(t.isoWeek("2026-10-07"), 41);
  assert.equal(t.isoWeek("2027-01-01"), 53);
  assert.equal(t.berlinToInstant("2026-10-07", "08:00").toISOString(), "2026-10-07T06:00:00.000Z");
  assert.equal(t.berlinToInstant("2026-12-01", "08:00").toISOString(), "2026-12-01T07:00:00.000Z");
  assert.equal(t.berlinToInstant("2026-03-29", "03:00").toISOString(), "2026-03-29T01:00:00.000Z");
  assert.equal(t.dayKeyOf(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
  assert.equal(t.minutesOfDay(new Date("2026-10-07T06:30:00Z")), 510);
  assert.equal(t.isTime("24:00"), false);
  assert.equal(t.isDayKey("2026-02-30"), false);
  assert.equal(t.isDayKey("2026-02-28"), true);
});

test("wished appointment from the website form (task-20-13)", () => {
  assert.equal(formatWish("2026-10-29", "10:00"), "Do., 29.10.2026, 10:00 Uhr");
  assert.equal(formatWish("2026-10-29", "morning"), "Do., 29.10.2026, vormittags");
  assert.equal(formatWish("2026-10-29", null), "Do., 29.10.2026, Uhrzeit beliebig");
  assert.equal(formatWish(null, "afternoon"), `${EMPTY}, nachmittags`);
});
