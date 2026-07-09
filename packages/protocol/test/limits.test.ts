import assert from "node:assert/strict";
import test from "node:test";
import {
  AttachmentBlobRecord,
  DeviceRecord,
  RoomRecord,
  maxAttachmentBlobTypeChars,
  maxCiphertextNonceChars,
  maxEnvelopeNonceChars,
  maxProjectPathChars,
  maxPublicKeyFingerprintChars,
  maxRoomNameChars,
  maxRoomProjectPathChars
} from "../src/index.js";

test("semantic protocol limits share their canonical values", () => {
  assert.equal(maxRoomProjectPathChars, maxProjectPathChars);
  assert.equal(maxEnvelopeNonceChars, maxCiphertextNonceChars);
});

test("room, attachment, and device schemas enforce their exported semantic limits", () => {
  assert.equal(RoomRecord.shape.name.safeParse("r".repeat(maxRoomNameChars)).success, true);
  assert.equal(RoomRecord.shape.name.safeParse("r".repeat(maxRoomNameChars + 1)).success, false);
  assert.equal(
    AttachmentBlobRecord.shape.type.safeParse("t".repeat(maxAttachmentBlobTypeChars)).success,
    true
  );
  assert.equal(
    AttachmentBlobRecord.shape.type.safeParse("t".repeat(maxAttachmentBlobTypeChars + 1)).success,
    false
  );
  assert.equal(
    DeviceRecord.shape.publicKeyFingerprint.safeParse(
      "f".repeat(maxPublicKeyFingerprintChars)
    ).success,
    true
  );
  assert.equal(
    DeviceRecord.shape.publicKeyFingerprint.safeParse(
      "f".repeat(maxPublicKeyFingerprintChars + 1)
    ).success,
    false
  );
});
