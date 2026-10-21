import { test } from "node:test";
import assert from "node:assert/strict";
import { contractBadge, contractHint, contractState, contractTerm, isContractActive, normalizeContractNumber } from "../../lib/service-contract.ts";

test("contract numbers are normalized from spoken or typed variants", () => {
  for (const value of ["SLA-2021-801", "sla 2021 801", "SLA2021801", "2021-801", " SLA-2021-801 "]) assert.equal(normalizeContractNumber(value), "SLA-2021-801", value);
  assert.equal(normalizeContractNumber("K-10007"), null);
  assert.equal(normalizeContractNumber(""), null);
});

const contract = { contract_number: "SLA-2021-801", postal_codes: ["69115"], emergency_24_7: true, valid_from: "2021-03-01", valid_until: null };

test("hint follows validity, site and 24/7", () => {
  assert.equal(contractHint(contract, "69115", "2026-10-15").state, "valid_24_7");
  assert.equal(contractHint({ ...contract, emergency_24_7: false }, "69115", "2026-10-15").state, "valid");
  assert.equal(contractHint(contract, "68159", "2026-10-15").state, "site_missing");
  assert.equal(contractHint({ ...contract, postal_codes: [] }, "68159", "2026-10-15").state, "valid_24_7");
  assert.equal(contractHint({ ...contract, valid_until: "2026-06-30" }, "69115", "2026-10-15").state, "expired");
  assert.equal(contractHint({ ...contract, valid_from: "2027-01-01" }, "69115", "2026-10-15").state, "not_yet");
  assert.equal(contractHint(null, "69115", "2026-10-15").state, "unknown");
  assert.match(contractHint({ ...contract, valid_until: "2026-06-30" }, "69115", "2026-10-15").text, /30\.06\.2026/);
});

test("contract state without a site for customer list and page (task-16-3)", () => {
  assert.equal(contractState(contract, "2026-10-15"), "valid_24_7");
  assert.equal(contractState({ ...contract, emergency_24_7: false }, "2026-10-15"), "valid");
  assert.equal(contractState({ ...contract, valid_until: "2026-06-30" }, "2026-10-15"), "expired");
  assert.equal(contractState({ ...contract, valid_until: "2026-10-15" }, "2026-10-15"), "valid_24_7", "last day still valid");
  assert.equal(contractState({ ...contract, valid_from: "2027-01-01" }, "2026-10-15"), "not_yet");
  assert.equal(isContractActive({ ...contract, valid_until: "2026-06-30" }, "2026-10-15"), false);
  assert.deepEqual(contractBadge(contract, "2026-10-15"), { label: "SLA 24/7", tone: "success" });
  assert.equal(contractBadge({ ...contract, valid_from: "2027-01-01" }, "2026-10-15").label, "SLA ab 01.01.2027");
  assert.equal(contractTerm(contract), "seit 01.03.2021");
  assert.equal(contractTerm({ ...contract, valid_from: "2020-07-01", valid_until: "2026-06-30" }), "01.07.2020 – 30.06.2026");
});
