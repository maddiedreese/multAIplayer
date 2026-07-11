import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRoomSecret,
  decryptAttachmentJson,
  encryptAttachmentJson,
  type AttachmentCryptoContext
} from "../src/index";

const context: AttachmentCryptoContext = {
  teamId: "team-1",
  roomId: "room-1",
  name: "report.txt",
  type: "text/plain",
  size: 12
};

const decryptionFailure = /operation-specific reason|decrypt|bad decrypt|The operation failed/i;

function flipBase64Byte(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 1;
  return bytes.toString("base64");
}

test("attachment ciphertext v3 round-trips with canonical envelope fields", async () => {
  const secret = await createRoomSecret();
  const value = { chunks: ["private", "content"] };
  const payload = await encryptAttachmentJson(value, secret, context);

  assert.equal(payload.version, 3);
  assert.equal(payload.algorithm, "AES-GCM-256");
  assert.equal(Buffer.from(payload.nonce, "base64").byteLength, 12);
  assert.ok(Buffer.from(payload.ciphertext, "base64").byteLength > 16);
  assert.deepEqual(await decryptAttachmentJson(payload, secret, context), value);
});

test("attachment ciphertext authenticates every context field", async () => {
  const secret = await createRoomSecret();
  const payload = await encryptAttachmentJson({ private: true }, secret, context);
  const changed: AttachmentCryptoContext[] = [
    { ...context, teamId: "team-2" },
    { ...context, roomId: "room-2" },
    { ...context, name: "other.txt" },
    { ...context, type: "application/octet-stream" },
    { ...context, size: context.size + 1 }
  ];

  for (const candidate of changed) {
    await assert.rejects(() => decryptAttachmentJson(payload, secret, candidate), decryptionFailure);
  }
});

test("attachment context rejects each empty or invalid field and accepts zero size", async () => {
  const secret = await createRoomSecret();
  const invalid: AttachmentCryptoContext[] = [
    { ...context, teamId: "" },
    { ...context, roomId: "" },
    { ...context, name: "" },
    { ...context, type: "" },
    { ...context, size: -1 },
    { ...context, size: 1.5 },
    { ...context, size: Number.NaN },
    { ...context, size: Number.MAX_SAFE_INTEGER + 1 }
  ];

  for (const candidate of invalid) {
    await assert.rejects(() => encryptAttachmentJson({}, secret, candidate), /Invalid attachment crypto context/);
  }

  const empty = { ...context, size: 0 };
  const payload = await encryptAttachmentJson({}, secret, empty);
  assert.deepEqual(await decryptAttachmentJson(payload, secret, empty), {});
});

test("attachment ciphertext rejects wrong keys, tampering, versions, and algorithms", async () => {
  const secret = await createRoomSecret();
  const wrongSecret = await createRoomSecret();
  const payload = await encryptAttachmentJson({ private: true }, secret, context);

  await assert.rejects(() => decryptAttachmentJson(payload, wrongSecret, context), decryptionFailure);
  await assert.rejects(
    () => decryptAttachmentJson({ ...payload, nonce: flipBase64Byte(payload.nonce) }, secret, context),
    decryptionFailure
  );
  await assert.rejects(
    () => decryptAttachmentJson({ ...payload, ciphertext: flipBase64Byte(payload.ciphertext) }, secret, context),
    decryptionFailure
  );
  for (const version of [1, 4, undefined]) {
    await assert.rejects(
      () => decryptAttachmentJson({ ...payload, version } as never, secret, context),
      /Unsupported ciphertext version/
    );
  }
  await assert.rejects(
    () => decryptAttachmentJson({ ...payload, algorithm: "AES-GCM-128" } as never, secret, context),
    /Unsupported ciphertext algorithm/
  );
});
