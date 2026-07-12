import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRoomSecret,
  decryptAttachmentJson,
  decryptJson,
  decryptLocalJson,
  encryptAttachmentJson,
  encryptJson,
  encryptLocalJson,
  type AttachmentCryptoContext,
  type LocalCryptoContext,
  type RoomSecret
} from "../src/index";

const roomMetadata = {
  id: "message-1",
  teamId: "team-1",
  roomId: "room-1",
  senderDeviceId: "device-1",
  senderUserId: "user-1",
  createdAt: "2026-07-11T12:00:00.000Z",
  kind: "chat.message" as const,
  keyEpoch: 3
};

const localContext: LocalCryptoContext = {
  purpose: "room-history",
  roomId: roomMetadata.roomId,
  keyEpoch: roomMetadata.keyEpoch,
  savedAt: roomMetadata.createdAt
};

const attachmentContext: AttachmentCryptoContext = {
  teamId: roomMetadata.teamId,
  roomId: roomMetadata.roomId,
  name: "message.json",
  type: "application/json",
  size: 42
};

const decryptionFailure = /operation-specific reason|decrypt|bad decrypt|The operation failed/i;

async function encryptLegacy(value: unknown, secret: RoomSecret, additionalData: unknown) {
  const key = await crypto.subtle.importKey("raw", Buffer.from(secret.rawKey, "base64"), { name: "AES-GCM" }, false, [
    "encrypt"
  ]);
  const nonce = new Uint8Array(12);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: new TextEncoder().encode(JSON.stringify(additionalData))
    },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return {
    version: 2 as const,
    algorithm: "AES-GCM-256" as const,
    nonce: Buffer.from(nonce).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64")
  };
}

test("room ciphertext routes canonical and legacy AAD only by its declared version", async () => {
  const secret = await createRoomSecret();
  const canonical = await encryptJson({ format: "canonical" }, secret, roomMetadata);
  const legacy = await encryptLegacy({ format: "legacy" }, secret, {
    domain: "multaiplayer:room-envelope:v2",
    ...roomMetadata
  });

  assert.deepEqual(await decryptJson(canonical, secret, roomMetadata), { format: "canonical" });
  assert.deepEqual(await decryptJson(legacy, secret, roomMetadata), { format: "legacy" });
  await assert.rejects(() => decryptJson({ ...canonical, version: 2 }, secret, roomMetadata), decryptionFailure);
  await assert.rejects(() => decryptJson({ ...legacy, version: 3 }, secret, roomMetadata), decryptionFailure);
});

test("local ciphertext routes canonical and legacy AAD only by its declared version", async () => {
  const secret = await createRoomSecret();
  const canonical = await encryptLocalJson({ format: "canonical" }, secret, localContext);
  const legacy = await encryptLegacy({ format: "legacy" }, secret, {
    domain: "multaiplayer:local-json:v2",
    ...localContext
  });

  assert.deepEqual(await decryptLocalJson(canonical, secret, localContext), { format: "canonical" });
  assert.deepEqual(await decryptLocalJson(legacy, secret, localContext), { format: "legacy" });
  await assert.rejects(() => decryptLocalJson({ ...canonical, version: 2 }, secret, localContext), decryptionFailure);
  await assert.rejects(() => decryptLocalJson({ ...legacy, version: 3 }, secret, localContext), decryptionFailure);
});

test("attachment ciphertext routes canonical and legacy AAD only by its declared version", async () => {
  const secret = await createRoomSecret();
  const canonical = await encryptAttachmentJson({ format: "canonical" }, secret, attachmentContext);
  const legacy = await encryptLegacy({ format: "legacy" }, secret, {
    domain: "multaiplayer:attachment:v2",
    ...attachmentContext
  });

  assert.deepEqual(await decryptAttachmentJson(canonical, secret, attachmentContext), { format: "canonical" });
  assert.deepEqual(await decryptAttachmentJson(legacy, secret, attachmentContext), { format: "legacy" });
  await assert.rejects(
    () => decryptAttachmentJson({ ...canonical, version: 2 }, secret, attachmentContext),
    decryptionFailure
  );
  await assert.rejects(
    () => decryptAttachmentJson({ ...legacy, version: 3 }, secret, attachmentContext),
    decryptionFailure
  );
});

test("room, local, and attachment ciphertext domains reject every directed substitution", async () => {
  const secret = await createRoomSecret();
  const room = await encryptJson({ domain: "room" }, secret, roomMetadata);
  const local = await encryptLocalJson({ domain: "local" }, secret, localContext);
  const attachment = await encryptAttachmentJson({ domain: "attachment" }, secret, attachmentContext);

  await assert.rejects(() => decryptLocalJson(room, secret, localContext), decryptionFailure);
  await assert.rejects(() => decryptAttachmentJson(room, secret, attachmentContext), decryptionFailure);
  await assert.rejects(() => decryptJson(local, secret, roomMetadata), decryptionFailure);
  await assert.rejects(() => decryptAttachmentJson(local, secret, attachmentContext), decryptionFailure);
  await assert.rejects(() => decryptJson(attachment, secret, roomMetadata), decryptionFailure);
  await assert.rejects(() => decryptLocalJson(attachment, secret, localContext), decryptionFailure);
});
