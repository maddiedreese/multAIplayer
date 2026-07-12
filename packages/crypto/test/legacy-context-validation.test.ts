import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeviceKeyAgreementIdentity,
  createRoomSecret,
  openDeviceSealedJson,
  unwrapRoomSecretForDevice,
  type DeviceCryptoContext,
  type WrappedRoomSecret
} from "../src/index";

const context: DeviceCryptoContext = {
  purpose: "invite-request",
  teamId: "team-1",
  roomId: "room-1",
  senderUserId: "user-1",
  senderDeviceId: "device-1",
  recipientDeviceId: "device-2",
  keyEpoch: 2
};

function legacyAdditionalData(domain: string, value: DeviceCryptoContext): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      domain,
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

async function createLegacyPayload(value: unknown, recipientPublicKeyJwk: JsonWebKey, domain: string) {
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
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: legacyAdditionalData(domain, context) },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return {
    ephemeralPublicKeyJwk: await crypto.subtle.exportKey("jwk", ephemeral.publicKey),
    nonce: Buffer.from(nonce).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64")
  };
}

test("legacy device-sealed and room-secret payloads validate contexts before decryption", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const sealed = {
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256" as const,
    ...(await createLegacyPayload({ legacy: "device" }, recipient.publicKeyJwk, "multaiplayer:device-sealed-json:v2"))
  };
  const wrapped = {
    version: 1 as const,
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256" as const,
    ...(await createLegacyPayload(secret, recipient.publicKeyJwk, "multaiplayer:room-secret-wrap:v2"))
  } as WrappedRoomSecret;

  assert.deepEqual(await openDeviceSealedJson(sealed, recipient.privateKeyJwk, context), { legacy: "device" });
  assert.deepEqual(await unwrapRoomSecretForDevice(wrapped, recipient.privateKeyJwk, context), secret);

  const invalid: Array<[DeviceCryptoContext, RegExp]> = [
    [{ ...context, purpose: "unsupported" as DeviceCryptoContext["purpose"] }, /Unsupported.*purpose/],
    [{ ...context, teamId: "" }, /teamId must be non-empty/],
    [{ ...context, roomId: "" }, /roomId must be non-empty/],
    [{ ...context, senderUserId: "" }, /senderUserId must be non-empty/],
    [{ ...context, senderDeviceId: "" }, /senderDeviceId must be non-empty/],
    [{ ...context, recipientDeviceId: "" }, /recipientDeviceId must be non-empty/],
    [{ ...context, keyEpoch: 0 }, /keyEpoch must be a positive safe integer/],
    [{ ...context, keyEpoch: 1.5 }, /keyEpoch must be a positive safe integer/],
    [{ ...context, previousEpoch: Number.NaN }, /previousEpoch must be a positive safe integer/],
    [{ ...context, newEpoch: Number.MAX_SAFE_INTEGER + 1 }, /newEpoch must be a positive safe integer/]
  ];

  for (const [candidate, expected] of invalid) {
    await assert.rejects(openDeviceSealedJson(sealed, recipient.privateKeyJwk, candidate), expected);
    await assert.rejects(unwrapRoomSecretForDevice(wrapped, recipient.privateKeyJwk, candidate), expected);
  }
});
