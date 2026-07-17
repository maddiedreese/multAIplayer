import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { executableKeyPackageValidator, KeyPackageValidatorBusyError } from "../src/mls/key-package-validator.js";
const upload = { id: "kp", keyPackage: "AA==", keyPackageHash: `sha256:${"a".repeat(64)}`, ciphersuite: 2 as const },
  uploader = {
    userId: "user",
    deviceId: "device-1",
    signaturePublicKey: "signature-public-key",
    signatureKeyFingerprint: "signature-fingerprint"
  };
test("KeyPackage validator fails closed for missing executables", async () =>
  assert.equal(await executableKeyPackageValidator("/definitely/missing/validator").validate(upload, uploader), null));
test("KeyPackage validator fails closed on timeout", async () => {
  const path = fileURLToPath(new URL("./fixtures/slow-keypackage-validator.mjs", import.meta.url));
  assert.equal(await executableKeyPackageValidator(path).validate(upload, uploader), null);
});
test("KeyPackage validator bounds concurrent child processes without queueing work", async () => {
  const path = fileURLToPath(new URL("./fixtures/delayed-keypackage-validator.mjs", import.meta.url));
  const validator = executableKeyPackageValidator(path, 2);
  const first = validator.validate(upload, uploader);
  const second = validator.validate(upload, uploader);
  await assert.rejects(validator.validate(upload, uploader), KeyPackageValidatorBusyError);
  const completed = await Promise.all([first, second]);
  assert.equal(completed.every(Boolean), true);
});
