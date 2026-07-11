import assert from "node:assert/strict";
import test from "node:test";

import { createDeviceKeyAgreementIdentity, importDevicePrivateKey, sealJsonToDevice } from "../src/index.js";

const context = {
  purpose: "invite-request" as const,
  teamId: "team-1",
  roomId: "room-1",
  senderUserId: "user-1",
  senderDeviceId: "device-1",
  recipientDeviceId: "device-2"
};

test("generated device identities contain usable P-256 ECDH material", async () => {
  const identity = await createDeviceKeyAgreementIdentity();

  assert.equal(identity.algorithm, "ECDH-P256-HKDF-SHA256-AES-GCM-256");
  assert.deepEqual({ kty: identity.publicKeyJwk.kty, crv: identity.publicKeyJwk.crv }, { kty: "EC", crv: "P-256" });
  assert.match(identity.publicKeyFingerprint, /^sha256:(?:[0-9a-f]{4}:){15}[0-9a-f]{4}$/);
  assert.equal(Number.isNaN(Date.parse(identity.createdAt)), false);

  const sealed = await sealJsonToDevice({ usable: true }, identity.publicKeyJwk, context);
  assert.equal(sealed.version, 3);
  assert.equal(sealed.ephemeralPublicKeyJwk.crv, "P-256");
});

test("persisted private JWKs import as constrained non-extractable handles", async () => {
  const identity = await createDeviceKeyAgreementIdentity();
  const key = await importDevicePrivateKey(identity.privateKeyJwk);

  assert.equal(key.type, "private");
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, "ECDH");
  assert.equal((key.algorithm as EcKeyAlgorithm).namedCurve, "P-256");
  assert.deepEqual([...key.usages].sort(), ["deriveBits", "deriveKey"]);
  await assert.rejects(crypto.subtle.exportKey("jwk", key));
});

test("runtime private-key handles reject the wrong type, algorithm, or curve", async () => {
  const ecdh = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveKey"
  ])) as CryptoKeyPair;
  assert.equal(await importDevicePrivateKey(ecdh.privateKey as unknown as JsonWebKey), ecdh.privateKey);
  await assert.doesNotReject(
    sealJsonToDevice({ valid: true }, (await createDeviceKeyAgreementIdentity()).publicKeyJwk, context)
  );

  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ecdsa = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify"
  ])) as CryptoKeyPair;
  const wrongCurve = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-384" }, false, [
    "deriveKey"
  ])) as CryptoKeyPair;

  for (const key of [ecdh.publicKey, aes, ecdsa.privateKey, wrongCurve.privateKey]) {
    await assert.rejects(importDevicePrivateKey(key as unknown as JsonWebKey), /P-256 ECDH private key/);
  }
});
