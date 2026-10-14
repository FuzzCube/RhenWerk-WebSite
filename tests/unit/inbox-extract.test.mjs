// Unit tests for the rule-based prefill of a new request from an inbox e-mail (task-10-10).
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRequestFields } from "../../lib/inbox-extract.ts";

const today = "2026-10-13";

test("Klassische Signatur: Firma, Name, Straße, PLZ/Ort, Telefon, Kompressor, Störung", () => {
  const body = `Sehr geehrte Damen und Herren,

unser Schraubenkompressor KAESER SM 13 schaltet seit gestern nach zehn Minuten ab, der Druck fällt auf 5 bar.
Bitte melden Sie sich zeitnah.

Mit freundlichen Grüßen

Max Mustermann
Instandhaltung
Muster Metallbau GmbH
Hafenstraße 12
40213 Düsseldorf
Tel. +49 211 123456-0
Fax +49 211 123456-9
www.muster-metallbau.de`;
  assert.deepEqual(extractRequestFields({ subject: "Kompressor schaltet ab", body, fromAddress: "m.mustermann@muster-metallbau.de", today }), {
    contact_name: "Max Mustermann",
    company_name: "Muster Metallbau GmbH",
    postal_code: "40213",
    city: "Düsseldorf",
    street_house_number: "Hafenstraße 12",
    phone_number: "+49 211 123456-0",
    equipment_kind: "compressor",
    service_kind: "diagnosis_repair",
    customer_urgency: "zeitnah",
    manufacturer: "KAESER",
    model_type: "SM 13",
  });
});

test("Beschriftete Angaben haben Vorrang, Adresse in einer Zeile, Wunschtermin", () => {
  const body = `Hallo,

wir benötigen die jährliche Wartung unserer Lüftungsanlage.

Firma: Bäckerei Sonnenschein e.K.
Ansprechpartnerin: Petra Klein
Telefon: 0221 / 98 76 54
Adresse: Am Markt 3, 50667 Köln
Kundennummer: K-10442
Wunschtermin: 27.10.2026

Viele Grüße
P. Klein`;
  const result = extractRequestFields({ subject: "Wartung Lüftung", body, fromAddress: "info@sonnenschein.test", today });
  assert.equal(result.company_name, "Bäckerei Sonnenschein e.K.");
  assert.equal(result.contact_name, "Petra Klein");
  assert.equal(result.phone_number, "0221 / 98 76 54");
  assert.equal(result.street_house_number, "Am Markt 3");
  assert.equal(result.postal_code, "50667");
  assert.equal(result.city, "Köln");
  assert.equal(result.customer_number, "K-10442");
  assert.equal(result.requested_visit_date, "2026-10-27");
  assert.equal(result.equipment_kind, "ventilation");
  assert.equal(result.service_kind, "scheduled_maintenance");
  assert.equal(result.customer_urgency, undefined);
});

test("Stillstand und Gefahrenhinweis: Produktionsstillstand, Sicherheitsgefahr unklar", () => {
  const body = `Unsere Pumpe in Halle 2 ist ausgefallen, die Produktion steht. Es riecht verschmort.
Bitte dringend jemanden schicken!

Gruß
Jan Becker
Becker Kunststofftechnik GmbH & Co. KG`;
  const result = extractRequestFields({ subject: "NOTFALL Pumpe", body, fromAddress: "einkauf@becker-kt.de", today });
  assert.equal(result.customer_urgency, "production_stop");
  assert.equal(result.safety_risk, "unclear");
  assert.equal(result.equipment_kind, "pump");
  assert.equal(result.service_kind, "diagnosis_repair");
  assert.equal(result.company_name, "Becker Kunststofftechnik GmbH & Co. KG");
  assert.equal(result.contact_name, "Jan Becker");
});

test("Zitierter Verlauf wird ignoriert, Name aus der Absenderadresse", () => {
  const body = `Können Sie die Inspektion nach DGUV im November machen?

Am 01.10.2026 schrieb RheinWerk Industrieservice GmbH <service@rheinwerk.test>:
> Ihre Pumpe wurde gewartet.
> RheinWerk Industrieservice GmbH, Rheinallee 1, 40221 Düsseldorf`;
  const result = extractRequestFields({ subject: "Inspektion", body, fromAddress: "anna.schmidt@kunde.test", today });
  assert.equal(result.contact_name, "Anna Schmidt");
  assert.equal(result.company_name, undefined);
  assert.equal(result.postal_code, undefined);
  assert.equal(result.service_kind, "inspection");
  assert.equal(result.equipment_kind, undefined);
});

test("Nichts erkannt: Werbung ohne Angaben bleibt leer, keine Sicherheitsangabe ohne Hinweis", () => {
  const result = extractRequestFields({ subject: "Newsletter Oktober", body: "Entdecken Sie unsere Angebote.", fromAddress: "newsletter@shop.test", today });
  assert.deepEqual(result, {});
});

test("„schaltet ständig ab“ ist eine Störung; Stillstand ohne weitere Angabe bedeutet Reparatur", () => {
  assert.equal(extractRequestFields({ subject: "Kompressor", body: "Der Kompressor schaltet ständig ab.", today }).service_kind, "diagnosis_repair");
  const standstill = extractRequestFields({ subject: "Anlage steht", body: "Unsere Lüftungsanlage steht still, Produktionsstillstand.", today });
  assert.equal(standstill.service_kind, "diagnosis_repair");
  assert.equal(standstill.customer_urgency, "production_stop");
});

test("Termin ohne Jahr in der Vergangenheit fällt ins nächste Jahr; Sammeladresse ergibt keinen Namen", () => {
  const result = extractRequestFields({ subject: "Wartung", body: "Wartung Kompressor, Termin am 05.01. wäre gut.", fromAddress: "info@firma.test", today });
  assert.equal(result.requested_visit_date, "2027-01-05");
  assert.equal(result.contact_name, undefined);
});
