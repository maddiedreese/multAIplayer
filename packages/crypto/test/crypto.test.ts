import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeviceKeyAgreementIdentity,
  createRoomSecret,
  decodeRoomInviteSecret,
  decryptJson,
  encryptJson,
  fingerprintPublicKey,
  openDeviceSealedJson,
  sealJsonToDevice,
  unwrapRoomSecretForDevice,
  validateRoomSecret,
  wrapRoomSecretForDevice
} from "../src/index";

const decryptionFailure = /operation-specific reason|decrypt|bad decrypt|The operation failed/i;

function flipBase64Bit(value: string): string {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  return btoa(String.fromCharCode(...bytes));
}

function flipBase64Byte(value: string, index: number): string {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  bytes[index] ^= 1;
  return btoa(String.fromCharCode(...bytes));
}

function encodeInviteValue(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

test("room secret wraps to a device public key and unwraps with its private key", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const otherDevice = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();

  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk);
  const unwrapped = await unwrapRoomSecretForDevice(wrapped, recipient.privateKeyJwk);

  assert.deepEqual(unwrapped, secret);
  await assert.rejects(() => unwrapRoomSecretForDevice(wrapped, otherDevice.privateKeyJwk), decryptionFailure);
});

test("wrapped room secret can decrypt room ciphertext after recovery", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const payload = await encryptJson({ hello: "room" }, secret);
  const recovered = await unwrapRoomSecretForDevice(
    await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk),
    recipient.privateKeyJwk
  );

  assert.deepEqual(await decryptJson(payload, recovered), { hello: "room" });
});

test("device-sealed JSON opens only for the target device", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const otherDevice = await createDeviceKeyAgreementIdentity();
  const sealed = await sealJsonToDevice({ eventType: "invite.request", requester: "Maddie" }, recipient.publicKeyJwk);

  assert.deepEqual(await openDeviceSealedJson(sealed, recipient.privateKeyJwk), {
    eventType: "invite.request",
    requester: "Maddie"
  });
  await assert.rejects(() => openDeviceSealedJson(sealed, otherDevice.privateKeyJwk), decryptionFailure);
});

test("device public key fingerprints are stable for canonical public fields", async () => {
  const identity = await createDeviceKeyAgreementIdentity();
  const fingerprint = await fingerprintPublicKey({
    y: identity.publicKeyJwk.y,
    x: identity.publicKeyJwk.x,
    crv: identity.publicKeyJwk.crv,
    kty: identity.publicKeyJwk.kty,
    ext: false
  });

  assert.equal(fingerprint, identity.publicKeyFingerprint);
  assert.match(fingerprint, /^[a-f0-9]{4}(:[a-f0-9]{4}){7}$/);
});

test("room secret validation rejects malformed key material with stable errors", () => {
  assert.throws(() => validateRoomSecret(null), /Room secret must be an object/);
  assert.throws(
    () => validateRoomSecret({ algorithm: "AES-GCM-128", rawKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }),
    /Unsupported room secret algorithm/
  );
  assert.throws(
    () => validateRoomSecret({ algorithm: "AES-GCM-256", rawKey: "not-a-256-bit-key" }),
    /Room key must be 256 bits/
  );
});

test("room ciphertext rejects tampering and the wrong room key", async () => {
  const secret = await createRoomSecret();
  const wrongSecret = await createRoomSecret();
  const payload = await encryptJson({ private: "message" }, secret);

  await assert.rejects(() => decryptJson(payload, wrongSecret), decryptionFailure);
  await assert.rejects(
    () => decryptJson({ ...payload, ciphertext: flipBase64Byte(payload.ciphertext, 0) }, secret),
    decryptionFailure
  );
  await assert.rejects(
    () => decryptJson({ ...payload, nonce: flipBase64Bit(payload.nonce) }, secret),
    decryptionFailure
  );
  const encryptedBytes = Uint8Array.from(atob(payload.ciphertext), (character) => character.charCodeAt(0));
  await assert.rejects(
    () =>
      decryptJson(
        { ...payload, ciphertext: flipBase64Byte(payload.ciphertext, encryptedBytes.byteLength - 1) },
        secret
      ),
    decryptionFailure
  );
});

test("AES-GCM room ciphertext wire format matches a fixed vector", async () => {
  const secret = {
    algorithm: "AES-GCM-256" as const,
    rawKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
  };
  const payload = {
    algorithm: "AES-GCM-256" as const,
    nonce: "oKGio6Slpqeoqaqr",
    ciphertext: "nToRSDa4Y9gHR73xYRO4uxSBL3Xxwy0eviIE5RDeG3XwTHCC3aExXBKSHBN4aUjkZzB8wA=="
  };

  assert.deepEqual(await decryptJson(payload, secret), { message: "fixed-vector", count: 7 });
});

test("device-sealed payload rejects ciphertext tampering", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const sealed = await sealJsonToDevice({ private: "invite" }, recipient.publicKeyJwk);

  await assert.rejects(
    () => openDeviceSealedJson({ ...sealed, ciphertext: flipBase64Bit(sealed.ciphertext) }, recipient.privateKeyJwk),
    decryptionFailure
  );
});

test("wrapped room secret rejects ciphertext tampering", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const wrapped = await wrapRoomSecretForDevice(await createRoomSecret(), recipient.publicKeyJwk);

  await assert.rejects(
    () =>
      unwrapRoomSecretForDevice({ ...wrapped, ciphertext: flipBase64Bit(wrapped.ciphertext) }, recipient.privateKeyJwk),
    decryptionFailure
  );
});

test("device seal and room-secret wrap contexts cannot be interchanged", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const sealed = await sealJsonToDevice(secret, recipient.publicKeyJwk);
  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk);

  await assert.rejects(() => openDeviceSealedJson(wrapped, recipient.privateKeyJwk), decryptionFailure);
  await assert.rejects(
    () => unwrapRoomSecretForDevice({ ...sealed, version: 1 }, recipient.privateKeyJwk),
    decryptionFailure
  );
});

test("crypto entry points reject malformed base64 payloads cleanly", async () => {
  const secret = await createRoomSecret();
  const recipient = await createDeviceKeyAgreementIdentity();
  const encrypted = await encryptJson({ hello: "room" }, secret);
  const sealed = await sealJsonToDevice({ hello: "device" }, recipient.publicKeyJwk);
  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk);

  await assert.rejects(() => decryptJson({ ...encrypted, ciphertext: "%%%" }, secret), /Invalid base64 encoding/);
  await assert.rejects(
    () => openDeviceSealedJson({ ...sealed, nonce: "%%%" }, recipient.privateKeyJwk),
    /Invalid base64 encoding/
  );
  await assert.rejects(
    () => unwrapRoomSecretForDevice({ ...wrapped, ciphertext: "%%%" }, recipient.privateKeyJwk),
    /Invalid base64 encoding/
  );
  assert.throws(() => decodeRoomInviteSecret("%%%"), /Invalid base64 encoding/);
  assert.throws(() => validateRoomSecret({ algorithm: "AES-GCM-256", rawKey: "%%%" }), /Room key must be 256 bits/);
});

test("device key entry points reject malformed public JWKs", async () => {
  const valid = (await createDeviceKeyAgreementIdentity()).publicKeyJwk;
  const malformedKeys: JsonWebKey[] = [
    { ...valid, crv: "P-384" },
    { ...valid, x: undefined },
    { ...valid, y: undefined },
    { ...valid, x: Buffer.alloc(33, 1).toString("base64url") },
    { ...valid, y: Buffer.alloc(33, 1).toString("base64url") }
  ];

  for (const malformedKey of malformedKeys) {
    await assert.rejects(() => sealJsonToDevice({ private: "invite" }, malformedKey));
    await assert.rejects(() =>
      wrapRoomSecretForDevice({ algorithm: "AES-GCM-256", rawKey: "A".repeat(43) + "=" }, malformedKey)
    );
  }
});

test("room invite decoding rejects malformed and incomplete values", () => {
  const validSecret = {
    algorithm: "AES-GCM-256",
    rawKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
  };
  const validInvite = { version: 1, teamId: "team-1", roomId: "room-1", roomName: "Room", secret: validSecret };

  assert.throws(() => decodeRoomInviteSecret(encodeInviteValue(validInvite).slice(0, -5)));
  assert.throws(() => decodeRoomInviteSecret(Buffer.from("not json", "utf8").toString("base64url")), SyntaxError);
  assert.throws(
    () => decodeRoomInviteSecret(encodeInviteValue({ ...validInvite, version: 2 })),
    /Unsupported invite version/
  );
  for (const field of ["teamId", "roomId", "roomName"] as const) {
    const incomplete = { ...validInvite };
    delete incomplete[field];
    assert.throws(() => decodeRoomInviteSecret(encodeInviteValue(incomplete)), /Invite is missing room metadata/);
  }
});

test("public key fingerprint wire format matches a fixed vector", async () => {
  assert.equal(
    await fingerprintPublicKey({
      crv: "P-256",
      kty: "EC",
      x: "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY",
      y: "T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU"
    }),
    "c71d:0170:0fb0:3288:70f1:ab58:0c93:9eea"
  );
});

test("public key fingerprints ignore non-public metadata and distinguish keys", async () => {
  const first = await createDeviceKeyAgreementIdentity();
  const second = await createDeviceKeyAgreementIdentity();

  assert.equal(
    await fingerprintPublicKey({ ...first.publicKeyJwk, key_ops: ["deriveKey"], use: "enc" }),
    first.publicKeyFingerprint
  );
  assert.notEqual(first.publicKeyFingerprint, second.publicKeyFingerprint);
});
