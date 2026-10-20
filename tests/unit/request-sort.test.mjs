// Unit tests for the sorting of the request list (task-12-12).
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SORT, nextSort, parseSort, sortLabel, sortParam } from "../../lib/request-sort.ts";

test("Standard: Eingang, neueste zuerst, nicht in der Adresse", () => {
  assert.deepEqual(parseSort(""), DEFAULT_SORT);
  assert.equal(sortParam(DEFAULT_SORT), null);
  assert.equal(sortLabel(DEFAULT_SORT), "Eingang, neueste zuerst");
});

test("Parameter aus der Adresse", () => {
  assert.deepEqual(parseSort("prioritaet-ab"), { key: "prioritaet", dir: "ab" });
  assert.deepEqual(parseSort("kunde-auf"), { key: "kunde", dir: "auf" });
  assert.equal(sortParam({ key: "eingang", dir: "auf" }), "eingang-auf");
  for (const value of ["status-ab", "kunde", "kunde-hoch", "KUNDE-auf", "kunde-auf;drop"]) assert.deepEqual(parseSort(value), DEFAULT_SORT, value);
});

test("Nicht erlaubte Spalte fällt auf den Standard zurück", () => {
  assert.deepEqual(parseSort("dispatcher-auf", ["eingang", "kunde"]), DEFAULT_SORT);
  assert.deepEqual(parseSort("kunde-ab", ["eingang", "kunde"]), { key: "kunde", dir: "ab" });
});

test("Klick auf den Spaltenkopf", () => {
  assert.deepEqual(nextSort(DEFAULT_SORT, "eingang"), { key: "eingang", dir: "auf" });
  assert.deepEqual(nextSort(DEFAULT_SORT, "prioritaet"), { key: "prioritaet", dir: "ab" });
  assert.deepEqual(nextSort({ key: "prioritaet", dir: "ab" }, "prioritaet"), { key: "prioritaet", dir: "auf" });
  assert.deepEqual(nextSort({ key: "prioritaet", dir: "ab" }, "kunde"), { key: "kunde", dir: "auf" });
  assert.equal(sortLabel({ key: "prioritaet", dir: "ab" }), "Priorität, höchste zuerst");
  assert.equal(sortLabel({ key: "leistung", dir: "auf" }), "Leistung, Inspektion zuerst");
});
