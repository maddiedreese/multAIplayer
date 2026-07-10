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

test("room secret wraps to a device public key and unwraps with its private key", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const otherDevice = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();

  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk);
  const unwrapped = await unwrapRoomSecretForDevice(wrapped, recipient.privateKeyJwk);

  assert.deepEqual(unwrapped, secret);
  await assert.rejects(
    () => unwrapRoomSecretForDevice(wrapped, otherDevice.privateKeyJwk),
    decryptionFailure
  );
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
  const sealed = await sealJsonToDevice(
    { eventType: "invite.request", requester: "Maddie" },
    recipient.publicKeyJwk
  );

  assert.deepEqual(await openDeviceSealedJson(sealed, recipient.privateKeyJwk), {
    eventType: "invite.request",
    requester: "Maddie"
  });
  await assert.rejects(
    () => openDeviceSealedJson(sealed, otherDevice.privateKeyJwk),
    decryptionFailure
  );
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
    () => decryptJson({ ...payload, ciphertext: flipBase64Bit(payload.ciphertext) }, secret),
    decryptionFailure
  );
  await assert.rejects(
    () => decryptJson({ ...payload, nonce: flipBase64Bit(payload.nonce) }, secret),
    decryptionFailure
  );
});

test("device-sealed payload rejects ciphertext tampering", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const sealed = await sealJsonToDevice({ private: "invite" }, recipient.publicKeyJwk);

  await assert.rejects(
    () => openDeviceSealedJson(
      { ...sealed, ciphertext: flipBase64Bit(sealed.ciphertext) },
      recipient.privateKeyJwk
    ),
    decryptionFailure
  );
});

test("wrapped room secret rejects ciphertext tampering", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const wrapped = await wrapRoomSecretForDevice(await createRoomSecret(), recipient.publicKeyJwk);

  await assert.rejects(
    () => unwrapRoomSecretForDevice(
      { ...wrapped, ciphertext: flipBase64Bit(wrapped.ciphertext) },
      recipient.privateKeyJwk
    ),
    decryptionFailure
  );
});

test("device seal and room-secret wrap contexts cannot be interchanged", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const sealed = await sealJsonToDevice(secret, recipient.publicKeyJwk);
  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk);

  await assert.rejects(
    () => openDeviceSealedJson(wrapped, recipient.privateKeyJwk),
    decryptionFailure
  );
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
  assert.throws(
    () => validateRoomSecret({ algorithm: "AES-GCM-256", rawKey: "%%%" }),
    /Room key must be 256 bits/
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
