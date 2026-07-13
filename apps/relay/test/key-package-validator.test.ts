import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { executableKeyPackageValidator } from "../src/mls/key-package-validator.js";
const upload = { id: "kp", keyPackage: "AA==", keyPackageHash: `sha256:${"a".repeat(64)}`, ciphersuite: 2 as const },
  uploader = { userId: "user", deviceId: "device-1" };
test("KeyPackage validator fails closed for missing executables", async () =>
  assert.equal(await executableKeyPackageValidator("/definitely/missing/validator").validate(upload, uploader), null));
test("KeyPackage validator fails closed on timeout", async () => {
  const path = fileURLToPath(new URL("./fixtures/slow-keypackage-validator.mjs", import.meta.url));
  assert.equal(await executableKeyPackageValidator(path).validate(upload, uploader), null);
});
