import { test } from "node:test";
import assert from "node:assert/strict";
import { contractHint, normalizeContractNumber } from "../../lib/service-contract.ts";

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
