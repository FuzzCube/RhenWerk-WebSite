// Probe für task-18-5: absichtlich roter Test, der Pull Request wird nicht gemergt.
import assert from "node:assert/strict";
import { test } from "node:test";

test("Probe: roter Test verhindert das Deployment", () => {
  assert.equal(1 + 1, 3);
});
