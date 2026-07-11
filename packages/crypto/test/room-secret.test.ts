import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeviceKeyAgreementIdentity,
  createRoomSecret,
  unwrapRoomSecretForDevice,
  validateRoomSecret,
  wrapRoomSecretForDevice,
  type DeviceCryptoContext,
  type RoomSecret,
  type WrappedRoomSecret
} from "../src/index.js";

const context: DeviceCryptoContext = {
  purpose: "invite-request",
  teamId: "team-1",
  roomId: "room-1",
  senderUserId: "user-1",
  senderDeviceId: "device-1",
  recipientDeviceId: "device-2"
};

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function legacyAdditionalData(value: DeviceCryptoContext): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      domain: "multaiplayer:room-secret-wrap:v2",
      purpose: value.purpose,
      teamId: value.teamId,
      roomId: value.roomId,
      senderUserId: value.senderUserId,
      senderDeviceId: value.senderDeviceId,
      recipientDeviceId: value.recipientDeviceId,
      operationId: value.operationId ?? null,
      requestId: value.requestId ?? null,
      requestNonce: value.requestNonce ?? null,
      keyEpoch: value.keyEpoch ?? null,
      previousEpoch: value.previousEpoch ?? null,
      newEpoch: value.newEpoch ?? null
    })
  );
}

async function createLegacyV1Wrap(
  secret: RoomSecret,
  recipient: Awaited<ReturnType<typeof createDeviceKeyAgreementIdentity>>
): Promise<WrappedRoomSecret> {
  const recipientKey = await crypto.subtle.importKey(
    "jwk",
    recipient.publicKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const ephemeral = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey"
  ])) as CryptoKeyPair;
  const key = await crypto.subtle.deriveKey(
    { name: "ECDH", public: recipientKey },
    ephemeral.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: legacyAdditionalData(context) },
    key,
    encoder.encode(JSON.stringify(secret))
  );
  const ephemeralJwk = await crypto.subtle.exportKey("jwk", ephemeral.publicKey);
  return {
    version: 1,
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
    ephemeralPublicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: ephemeralJwk.x!,
      y: ephemeralJwk.y!
    },
    nonce: Buffer.from(nonce).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64")
  };
}

test("room-secret generation returns independent canonical 256-bit AES keys", async () => {
  const first = await createRoomSecret();
  const second = await createRoomSecret();

  for (const secret of [first, second]) {
    assert.equal(secret.algorithm, "AES-GCM-256");
    assert.match(secret.rawKey, /^[A-Za-z0-9+/]{43}=$/);
    assert.equal(Buffer.from(secret.rawKey, "base64").byteLength, 32);
    assert.doesNotThrow(() => validateRoomSecret(secret));
  }
  assert.notEqual(second.rawKey, first.rawKey);
});

test("room-secret validation rejects invalid shapes, algorithms, encodings, and lengths", () => {
  for (const value of [null, undefined, false, 0, "secret", [], () => undefined]) {
    assert.throws(() => validateRoomSecret(value), /^Error: Room secret must be an object$/);
  }
  for (const algorithm of [undefined, null, "", "AES-GCM", "AES-GCM-128"]) {
    assert.throws(() => validateRoomSecret({ algorithm, rawKey: Buffer.alloc(32).toString("base64") }), /algorithm/);
  }
  for (const rawKey of [
    undefined,
    null,
    1,
    "",
    "not base64!",
    "A===",
    Buffer.alloc(31).toString("base64"),
    Buffer.alloc(33).toString("base64")
  ]) {
    assert.throws(() => validateRoomSecret({ algorithm: "AES-GCM-256", rawKey }), /256 bits/);
  }
  assert.doesNotThrow(() =>
    validateRoomSecret({ algorithm: "AES-GCM-256", rawKey: Buffer.alloc(32).toString("base64") })
  );
});

test("room-secret v2 wraps round-trip and validate their envelope discriminants", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk, context);

  assert.equal(wrapped.version, 2);
  assert.equal(wrapped.algorithm, "ECDH-P256-HKDF-SHA256-AES-GCM-256");
  assert.deepEqual(await unwrapRoomSecretForDevice(wrapped, recipient.privateKeyJwk, context), secret);

  for (const version of [0, 3, -1, 1.5]) {
    await assert.rejects(
      unwrapRoomSecretForDevice({ ...wrapped, version } as WrappedRoomSecret, recipient.privateKeyJwk, context),
      /Unsupported wrapped room secret/
    );
  }
  await assert.rejects(
    unwrapRoomSecretForDevice(
      { ...wrapped, algorithm: "AES-GCM-256" } as unknown as WrappedRoomSecret,
      recipient.privateKeyJwk,
      context
    ),
    /Unsupported wrapped room secret/
  );
});

test("room-secret v1 wraps use legacy AAD while v2 wraps use canonical AAD", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const legacy = await createLegacyV1Wrap(secret, recipient);
  const canonical = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk, context);

  assert.deepEqual(await unwrapRoomSecretForDevice(legacy, recipient.privateKeyJwk, context), secret);
  assert.deepEqual(await unwrapRoomSecretForDevice(canonical, recipient.privateKeyJwk, context), secret);
  await assert.rejects(unwrapRoomSecretForDevice({ ...legacy, version: 2 }, recipient.privateKeyJwk, context));
  await assert.rejects(unwrapRoomSecretForDevice({ ...canonical, version: 1 }, recipient.privateKeyJwk, context));

  assert.equal(decoder.decode(legacyAdditionalData(context)).includes('"domain"'), true);
});
