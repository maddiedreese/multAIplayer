import assert from "node:assert/strict";
import test from "node:test";
import {
  AttachmentBlobRecord,
  DeviceRecord,
  RoomRecord,
  isRecord,
  maxAttachmentBlobTypeChars,
  maxCiphertextNonceChars,
  maxEnvelopeNonceChars,
  maxProjectPathChars,
  maxRoomNameChars,
  maxRoomProjectPathChars
} from "../src/index.js";

test("semantic protocol limits share their canonical values", () => {
  assert.equal(maxRoomProjectPathChars, maxProjectPathChars);
  assert.equal(maxEnvelopeNonceChars, maxCiphertextNonceChars);
});

test("isRecord identifies non-null objects", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord([]), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord("record"), false);
});

test("isRecord covers every JavaScript type boundary", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord(Object.create(null)), true);
  assert.equal(isRecord([]), true);
  for (const value of [null, undefined, "record", 0, 1n, false, Symbol("record"), () => ({})]) {
    assert.equal(isRecord(value), false, typeof value);
  }
});

test("room, attachment, and device schemas enforce their exported semantic limits", () => {
  assert.equal(RoomRecord.shape.name.safeParse("r".repeat(maxRoomNameChars)).success, true);
  assert.equal(RoomRecord.shape.name.safeParse("r".repeat(maxRoomNameChars + 1)).success, false);
  assert.equal(AttachmentBlobRecord.shape.type.safeParse("t".repeat(maxAttachmentBlobTypeChars)).success, true);
  assert.equal(AttachmentBlobRecord.shape.type.safeParse("t".repeat(maxAttachmentBlobTypeChars + 1)).success, false);
  assert.equal(
    DeviceRecord.shape.publicKeyFingerprint.safeParse("sha256:" + "ffff:".repeat(15) + "ffff").success,
    true
  );
  assert.equal(DeviceRecord.shape.publicKeyFingerprint.safeParse("ffff:ffff").success, false);
});
