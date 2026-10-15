// Unit tests for the technician links (task-11-3). Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { routeHref, telHref } from "../../lib/contact-links.ts";

test("Route öffnet Google Maps mit Navigation zur Adresse", () => {
  const href = routeHref("Robert-Bosch-Straße 32, 46045 Oberhausen");
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, "https://www.google.com/maps/dir/");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("travelmode"), "driving");
  assert.equal(url.searchParams.get("destination"), "Robert-Bosch-Straße 32, 46045 Oberhausen");
  assert.ok(!href.includes("+"), "Leerzeichen als %20, nicht als +");
});

test("Route kodiert Sonderzeichen und Hausnummern", () => {
  for (const address of ["Am Hügel 12a & 14, 47798 Krefeld", "Gewerbering 116/2, 50667 Köln", "  Kanalstraße 57, 45127 Essen  "]) {
    assert.equal(new URL(routeHref(address)).searchParams.get("destination"), address.trim());
  }
  assert.ok(!routeHref("A & B, 1 Köln").includes("& B"), "& wird kodiert");
});

test("Anrufen nutzt nur Ziffern und führendes +", () => {
  assert.equal(telHref("+49 1450 376865"), "tel:+491450376865");
  assert.equal(telHref("(0621) 00000-0"), "tel:0621000000");
});
