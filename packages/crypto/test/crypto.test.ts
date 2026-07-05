import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeviceKeyAgreementIdentity,
  createRoomSecret,
  decryptJson,
  encryptJson,
  fingerprintPublicKey,
  openDeviceSealedJson,
  sealJsonToDevice,
  unwrapRoomSecretForDevice,
  validateRoomSecret,
  wrapRoomSecretForDevice
} from "../src/index";

test("room secret wraps to a device public key and unwraps with its private key", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const otherDevice = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();

  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk);
  const unwrapped = await unwrapRoomSecretForDevice(wrapped, recipient.privateKeyJwk);

  assert.deepEqual(unwrapped, secret);
  await assert.rejects(
    () => unwrapRoomSecretForDevice(wrapped, otherDevice.privateKeyJwk),
    /operation-specific reason|decrypt|bad decrypt|The operation failed/i
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
    /operation-specific reason|decrypt|bad decrypt|The operation failed/i
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
