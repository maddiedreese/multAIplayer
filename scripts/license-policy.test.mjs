import assert from "node:assert/strict";
import test from "node:test";
import { isDeniedLicenseExpression } from "./license-policy.mjs";

test("license policy accepts a permissive choice in an SPDX OR expression", () => {
  assert.equal(isDeniedLicenseExpression("(MIT OR GPL-3.0-or-later)"), false);
  assert.equal(isDeniedLicenseExpression("Apache-2.0 OR SSPL-1.0"), false);
});

test("license policy rejects expressions whose every choice is denied", () => {
  assert.equal(isDeniedLicenseExpression("GPL-3.0-only"), true);
  assert.equal(isDeniedLicenseExpression("GPL-2.0-only OR LGPL-3.0-only"), true);
  assert.equal(isDeniedLicenseExpression("MIT AND AGPL-3.0-only"), true);
});
