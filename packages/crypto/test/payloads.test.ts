import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeviceKeyAgreementIdentity,
  createRoomSecret,
  decryptJson,
  encryptJson,
  openDeviceSealedJson,
  sealJsonToDevice,
  type DeviceCryptoContext
} from "../src/index";

const metadata = {
  id: "message-1",
  teamId: "team-1",
  roomId: "room-1",
  senderDeviceId: "device-1",
  senderUserId: "user-1",
  createdAt: "2026-07-11T12:00:00.000Z",
  kind: "chat.message" as const,
  keyEpoch: 4
};

const deviceContext: DeviceCryptoContext = {
  purpose: "invite-request",
  teamId: "team-1",
  roomId: "room-1",
  senderUserId: "user-1",
  senderDeviceId: "device-1",
  recipientDeviceId: "device-2",
  requestId: "request-1",
  requestNonce: "request-nonce-1",
  keyEpoch: 4
};

const decryptionFailure = /operation-specific reason|decrypt|bad decrypt|The operation failed/i;

function flipBase64Byte(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 1;
  return bytes.toString("base64");
}

async function createLegacyDevicePayload(value: unknown, recipientPublicKeyJwk: JsonWebKey) {
  const ephemeral = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey"
  ])) as CryptoKeyPair;
  const recipientPublicKey = await crypto.subtle.importKey(
    "jwk",
    recipientPublicKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const key = await crypto.subtle.deriveKey(
    { name: "ECDH", public: recipientPublicKey },
    ephemeral.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const nonce = new Uint8Array(12);
  const aad = new TextEncoder().encode(
    JSON.stringify({
      domain: "multaiplayer:device-sealed-json:v2",
      purpose: deviceContext.purpose,
      teamId: deviceContext.teamId,
      roomId: deviceContext.roomId,
      senderUserId: deviceContext.senderUserId,
      senderDeviceId: deviceContext.senderDeviceId,
      recipientDeviceId: deviceContext.recipientDeviceId,
      operationId: null,
      requestId: deviceContext.requestId,
      requestNonce: deviceContext.requestNonce,
      keyEpoch: deviceContext.keyEpoch,
      previousEpoch: null,
      newEpoch: null
    })
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return {
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256" as const,
    ephemeralPublicKeyJwk: await crypto.subtle.exportKey("jwk", ephemeral.publicKey),
    nonce: Buffer.from(nonce).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64")
  };
}

test("room ciphertext v3 round-trips with canonical envelope fields", async () => {
  const secret = await createRoomSecret();
  const value = { text: "private message", sequence: 7 };
  const payload = await encryptJson(value, secret, metadata);

  assert.equal(payload.version, 3);
  assert.equal(payload.algorithm, "AES-GCM-256");
  assert.equal(Buffer.from(payload.nonce, "base64").byteLength, 12);
  assert.ok(Buffer.from(payload.ciphertext, "base64").byteLength > 16);
  assert.deepEqual(await decryptJson(payload, secret, metadata), value);
});

test("room ciphertext rejects unsupported versions and algorithms", async () => {
  const secret = await createRoomSecret();
  const payload = await encryptJson({ private: true }, secret, metadata);

  for (const version of [1, 4, undefined]) {
    await assert.rejects(
      () => decryptJson({ ...payload, version } as never, secret, metadata),
      /Unsupported ciphertext version/
    );
  }
  await assert.rejects(
    () => decryptJson({ ...payload, algorithm: "AES-GCM-128" } as never, secret, metadata),
    /Unsupported ciphertext algorithm/
  );
});

test("device-sealed v3 payload round-trips with canonical envelope fields", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const value = { invitation: "secret" };
  const payload = await sealJsonToDevice(value, recipient.publicKeyJwk, deviceContext);

  assert.equal(payload.version, 3);
  assert.equal(payload.algorithm, "ECDH-P256-HKDF-SHA256-AES-GCM-256");
  assert.equal(Buffer.from(payload.nonce, "base64").byteLength, 12);
  assert.ok(Buffer.from(payload.ciphertext, "base64").byteLength > 16);
  assert.equal(payload.ephemeralPublicKeyJwk.kty, "EC");
  assert.equal(payload.ephemeralPublicKeyJwk.crv, "P-256");
  assert.deepEqual(await openDeviceSealedJson(payload, recipient.privateKeyJwk, deviceContext), value);
});

test("device-sealed decryption routes genuine unversioned legacy payloads", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const payload = await createLegacyDevicePayload({ legacy: true }, recipient.publicKeyJwk);
  assert.deepEqual(await openDeviceSealedJson(payload, recipient.privateKeyJwk, deviceContext), { legacy: true });
});

test("device-sealed payload rejects invalid envelopes and tampering", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const otherRecipient = await createDeviceKeyAgreementIdentity();
  const payload = await sealJsonToDevice({ invitation: "secret" }, recipient.publicKeyJwk, deviceContext);

  await assert.rejects(
    () => openDeviceSealedJson({ ...payload, algorithm: "ECDH-P384" } as never, recipient.privateKeyJwk, deviceContext),
    /Unsupported device-sealed payload/
  );
  for (const version of [2, 4]) {
    await assert.rejects(
      () => openDeviceSealedJson({ ...payload, version } as never, recipient.privateKeyJwk, deviceContext),
      /Unsupported device-sealed payload/
    );
  }
  await assert.rejects(
    () => openDeviceSealedJson(payload, otherRecipient.privateKeyJwk, deviceContext),
    decryptionFailure
  );
  await assert.rejects(
    () =>
      openDeviceSealedJson(
        { ...payload, nonce: flipBase64Byte(payload.nonce) },
        recipient.privateKeyJwk,
        deviceContext
      ),
    decryptionFailure
  );
  await assert.rejects(
    () =>
      openDeviceSealedJson(
        { ...payload, ciphertext: flipBase64Byte(payload.ciphertext) },
        recipient.privateKeyJwk,
        deviceContext
      ),
    decryptionFailure
  );
  await assert.rejects(
    () =>
      openDeviceSealedJson(
        { ...payload, ephemeralPublicKeyJwk: otherRecipient.publicKeyJwk },
        recipient.privateKeyJwk,
        deviceContext
      ),
    decryptionFailure
  );
});
