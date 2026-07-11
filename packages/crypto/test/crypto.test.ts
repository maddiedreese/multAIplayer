import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDeviceKeyAgreementIdentity,
  createInviteCapability,
  canonicalAuthenticatedRecord,
  computeInviteCapabilityMac,
  createRoomSecret,
  deriveNextRoomSecret,
  decryptAttachmentJson,
  decryptJson,
  decryptLocalJson,
  encryptJson,
  encryptLocalJson,
  fingerprintPublicKey,
  openDeviceSealedJson,
  sealJsonToDevice,
  sameDevicePublicKey,
  unwrapRoomSecretForDevice,
  validateRoomSecret,
  wrapRoomSecretForDevice,
  wrapRoomSecretAuthenticatedForDevice,
  unwrapRoomSecretAuthenticatedFromDevice,
  verifyInviteCapabilityMac
} from "../src/index";

const decryptionFailure = /operation-specific reason|decrypt|bad decrypt|The operation failed/i;

test("same host authority deterministically derives one key for concurrent next-epoch rotations", async () => {
  const previous = await createRoomSecret();
  const host = await createDeviceKeyAgreementIdentity();
  const context = { teamId: "team-cas", roomId: "room-cas", previousEpoch: 3, newEpoch: 4 };
  const first = await deriveNextRoomSecret(previous, host.privateKeyJwk, context);
  const concurrent = await deriveNextRoomSecret(previous, host.privateKeyJwk, context);
  assert.deepEqual(concurrent, first);
  assert.notDeepEqual(
    await deriveNextRoomSecret(previous, host.privateKeyJwk, { ...context, roomId: "room-other" }),
    first
  );
});

test("invite capabilities authenticate every canonical request binding", async () => {
  const capability = createInviteCapability();
  const binding = {
    phase: "request" as const,
    inviteId: "invite-1",
    teamId: "team-1",
    roomId: "room-1",
    keyEpoch: 1,
    requestId: "request-1",
    requestNonce: "abcdefghijklmnopqrstuv",
    requesterUserId: "github:peer",
    requesterDeviceId: "device-peer",
    requesterPublicKeyFingerprint: "sha256:peer",
    hostUserId: "github:host",
    hostDeviceId: "device-host",
    hostPublicKeyFingerprint: "sha256:host"
  };
  const mac = await computeInviteCapabilityMac(capability, binding);
  assert.match(capability, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await verifyInviteCapabilityMac(capability, binding, mac), true);
  assert.equal(await verifyInviteCapabilityMac(capability, { ...binding, requesterDeviceId: "attacker" }, mac), false);
  assert.equal(await verifyInviteCapabilityMac(createInviteCapability(), binding, mac), false);

  const reordered = Object.fromEntries(Object.entries(binding).reverse()) as typeof binding;
  assert.equal(await computeInviteCapabilityMac(capability, reordered), mac);
  assert.equal(await verifyInviteCapabilityMac(capability, reordered, mac), true);
});

test("invite capabilities are independent fresh 256-bit bearer secrets", async () => {
  const beforeRoomSecret = createInviteCapability();
  await createRoomSecret();
  const afterRoomSecret = createInviteCapability();
  const generated = new Set([beforeRoomSecret, afterRoomSecret]);
  for (let index = 0; index < 64; index += 1) generated.add(createInviteCapability());
  assert.equal(generated.size, 66);
  for (const capability of generated) assert.match(capability, /^[A-Za-z0-9_-]{43}$/);
});

test("authenticated records are versioned, domain-separated, and property-order independent", () => {
  const first = canonicalAuthenticatedRecord("multaiplayer:test", 1, { z: "tail", a: "head", count: 7 });
  const reordered = canonicalAuthenticatedRecord("multaiplayer:test", 1, { count: 7, a: "head", z: "tail" });
  assert.deepEqual(reordered, first);
  assert.notDeepEqual(canonicalAuthenticatedRecord("multaiplayer:other", 1, { z: "tail", a: "head", count: 7 }), first);
  assert.notDeepEqual(canonicalAuthenticatedRecord("multaiplayer:test", 2, { z: "tail", a: "head", count: 7 }), first);
  assert.equal(
    new TextDecoder().decode(first),
    '{"a":"head","count":7,"domain":"multaiplayer:test","version":1,"z":"tail"}'
  );
  assert.throws(
    () => canonicalAuthenticatedRecord("multaiplayer:test", 1, { invalid: 1.5 }),
    /Unsupported canonical authenticated field/
  );
  assert.throws(
    () => canonicalAuthenticatedRecord("multaiplayer:test", 1, { nested: { order: "unsafe" } } as never),
    /Unsupported canonical authenticated field/
  );
  assert.throws(
    () => canonicalAuthenticatedRecord("multaiplayer:test", 1, { "not-ascii!": "unsafe" }),
    /Invalid canonical authenticated field name/
  );
});

test("device public-key equality is structural and ignores JWK serialization metadata", async () => {
  const identity = await createDeviceKeyAgreementIdentity();
  const reordered = {
    y: identity.publicKeyJwk.y,
    key_ops: [],
    x: identity.publicKeyJwk.x,
    ext: false,
    crv: identity.publicKeyJwk.crv,
    kty: identity.publicKeyJwk.kty
  };
  assert.equal(sameDevicePublicKey(identity.publicKeyJwk, reordered), true);
  assert.equal(sameDevicePublicKey(identity.publicKeyJwk, { ...reordered, x: "substituted" }), false);
  assert.equal(sameDevicePublicKey(identity.publicKeyJwk, { ...reordered, d: "private" }), false);
});
const metadata = {
  id: "envelope-1",
  teamId: "team-1",
  roomId: "room-1",
  senderDeviceId: "device-1",
  senderUserId: "user-1",
  createdAt: "2026-07-10T12:00:00.000Z",
  kind: "chat.message" as const,
  keyEpoch: 1
};
const deviceContext = {
  purpose: "invite-request" as const,
  teamId: "team-1",
  roomId: "room-1",
  senderUserId: "user-1",
  senderDeviceId: "device-1",
  recipientDeviceId: "device-2"
};
const rotationContext = {
  ...deviceContext,
  purpose: "room-key-rotation" as const,
  operationId: "rotation-1",
  keyEpoch: 3,
  previousEpoch: 3,
  newEpoch: 4
};

function legacyDeviceContextData(domain: string, context: typeof rotationContext): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      domain,
      purpose: context.purpose,
      teamId: context.teamId,
      roomId: context.roomId,
      senderUserId: context.senderUserId,
      senderDeviceId: context.senderDeviceId,
      recipientDeviceId: context.recipientDeviceId,
      operationId: context.operationId ?? null,
      requestId: "requestId" in context ? context.requestId : null,
      requestNonce: "requestNonce" in context ? context.requestNonce : null,
      keyEpoch: context.keyEpoch ?? null,
      previousEpoch: context.previousEpoch ?? null,
      newEpoch: context.newEpoch ?? null
    })
  );
}

async function legacyAuthenticatedWrap(
  secret: Awaited<ReturnType<typeof createRoomSecret>>,
  host: Awaited<ReturnType<typeof createDeviceKeyAgreementIdentity>>,
  recipient: Awaited<ReturnType<typeof createDeviceKeyAgreementIdentity>>,
  context: typeof rotationContext
) {
  const hostPrivateJwk = { ...host.privateKeyJwk };
  delete hostPrivateJwk.key_ops;
  delete hostPrivateJwk.use;
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    hostPrivateJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    recipient.publicKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aad = legacyDeviceContextData("multaiplayer:authenticated-room-secret-wrap:v2", context);
  const salt = await crypto.subtle.digest("SHA-256", aad);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: new TextEncoder().encode("multaiplayer:authenticated-room-secret-wrap:v2")
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const nonce = new Uint8Array(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    key,
    new TextEncoder().encode(JSON.stringify(secret))
  );
  return {
    version: 2 as const,
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256" as const,
    senderPublicKeyJwk: host.publicKeyJwk,
    nonce: Buffer.from(nonce).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64")
  };
}

test("invite approval wraps round-trip with request identity, nonce, and epoch binding", async () => {
  const host = await createDeviceKeyAgreementIdentity();
  const requester = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const context = {
    ...deviceContext,
    purpose: "invite-response" as const,
    requestId: "device-2:request-1",
    requestNonce: "abcdefghijklmnopqrstuv",
    keyEpoch: 7
  };
  const wrapped = await wrapRoomSecretAuthenticatedForDevice(secret, host, requester.publicKeyJwk, context);
  assert.deepEqual(
    await unwrapRoomSecretAuthenticatedFromDevice(wrapped, requester.privateKeyJwk, host.publicKeyJwk, context),
    secret
  );
  for (const tampered of [
    { ...context, requestId: "device-2:request-2" },
    { ...context, requestNonce: "zyxwvutsrqponmlkjihgfe" },
    { ...context, keyEpoch: 8 }
  ]) {
    await assert.rejects(
      () => unwrapRoomSecretAuthenticatedFromDevice(wrapped, requester.privateKeyJwk, host.publicKeyJwk, tampered),
      decryptionFailure
    );
  }
});

test("rotation wraps authenticate the pinned static host key and epoch transition", async () => {
  const host = await createDeviceKeyAgreementIdentity();
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const wrapped = await wrapRoomSecretAuthenticatedForDevice(secret, host, recipient.publicKeyJwk, rotationContext);
  assert.deepEqual(
    await unwrapRoomSecretAuthenticatedFromDevice(wrapped, recipient.privateKeyJwk, host.publicKeyJwk, rotationContext),
    secret
  );
  await assert.rejects(
    () =>
      unwrapRoomSecretAuthenticatedFromDevice(wrapped, recipient.privateKeyJwk, host.publicKeyJwk, {
        ...rotationContext,
        operationId: "forged"
      }),
    decryptionFailure
  );
});

test("version 2 authenticated room-secret wraps remain readable", async () => {
  const host = await createDeviceKeyAgreementIdentity();
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const wrapped = await legacyAuthenticatedWrap(secret, host, recipient, rotationContext);
  assert.deepEqual(
    await unwrapRoomSecretAuthenticatedFromDevice(wrapped, recipient.privateKeyJwk, host.publicKeyJwk, rotationContext),
    secret
  );
});

test("old-key holders cannot forge an authenticated host rotation delivery", async () => {
  const host = await createDeviceKeyAgreementIdentity();
  const attacker = await createDeviceKeyAgreementIdentity();
  const recipient = await createDeviceKeyAgreementIdentity();
  const forged = await wrapRoomSecretAuthenticatedForDevice(
    await createRoomSecret(),
    attacker,
    recipient.publicKeyJwk,
    rotationContext
  );
  await assert.rejects(
    () => unwrapRoomSecretAuthenticatedFromDevice(forged, recipient.privateKeyJwk, host.publicKeyJwk, rotationContext),
    /does not match the pinned host key/
  );
});

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

test("room secret wraps to a device public key and unwraps with its private key", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const otherDevice = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();

  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk, deviceContext);
  const unwrapped = await unwrapRoomSecretForDevice(wrapped, recipient.privateKeyJwk, deviceContext);

  assert.deepEqual(unwrapped, secret);
  await assert.rejects(
    () => unwrapRoomSecretForDevice(wrapped, otherDevice.privateKeyJwk, deviceContext),
    decryptionFailure
  );
  await assert.rejects(
    () =>
      unwrapRoomSecretForDevice(wrapped, recipient.privateKeyJwk, {
        ...deviceContext,
        recipientDeviceId: "substituted"
      }),
    decryptionFailure
  );
});

test("wrapped room secret can decrypt room ciphertext after recovery", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const payload = await encryptJson({ hello: "room" }, secret, metadata);
  const recovered = await unwrapRoomSecretForDevice(
    await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk, deviceContext),
    recipient.privateKeyJwk,
    deviceContext
  );

  assert.deepEqual(await decryptJson(payload, recovered, metadata), { hello: "room" });
});

test("device-sealed JSON opens only for the target device", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const otherDevice = await createDeviceKeyAgreementIdentity();
  const sealed = await sealJsonToDevice(
    { eventType: "invite.request", requester: "Maddie" },
    recipient.publicKeyJwk,
    deviceContext
  );

  assert.deepEqual(await openDeviceSealedJson(sealed, recipient.privateKeyJwk, deviceContext), {
    eventType: "invite.request",
    requester: "Maddie"
  });
  await assert.rejects(() => openDeviceSealedJson(sealed, otherDevice.privateKeyJwk, deviceContext), decryptionFailure);
  await assert.rejects(
    () => openDeviceSealedJson(sealed, recipient.privateKeyJwk, { ...deviceContext, senderUserId: "attacker" }),
    decryptionFailure
  );
});

test("local ciphertext is bound to its room, epoch, timestamp, and purpose", async () => {
  const secret = await createRoomSecret();
  const context = {
    purpose: "room-history" as const,
    roomId: "room-1",
    keyEpoch: 3,
    savedAt: "2026-07-10T12:00:00.000Z"
  };
  const encrypted = await encryptLocalJson({ messages: ["private"] }, secret, context);
  assert.deepEqual(await decryptLocalJson(encrypted, secret, context), { messages: ["private"] });
  await assert.rejects(() => decryptLocalJson(encrypted, secret, { ...context, keyEpoch: 4 }), decryptionFailure);
  await assert.rejects(() => decryptLocalJson(encrypted, secret, { ...context, roomId: "room-2" }), decryptionFailure);
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
  assert.match(fingerprint, /^sha256:[a-f0-9]{4}(:[a-f0-9]{4}){15}$/);
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
  const payload = await encryptJson({ private: "message" }, secret, metadata);

  await assert.rejects(() => decryptJson(payload, wrongSecret, metadata), decryptionFailure);
  await assert.rejects(
    () => decryptJson({ ...payload, ciphertext: flipBase64Byte(payload.ciphertext, 0) }, secret, metadata),
    decryptionFailure
  );
  await assert.rejects(
    () => decryptJson({ ...payload, nonce: flipBase64Bit(payload.nonce) }, secret, metadata),
    decryptionFailure
  );
  const encryptedBytes = Uint8Array.from(atob(payload.ciphertext), (character) => character.charCodeAt(0));
  await assert.rejects(
    () =>
      decryptJson(
        { ...payload, ciphertext: flipBase64Byte(payload.ciphertext, encryptedBytes.byteLength - 1) },
        secret,
        metadata
      ),
    decryptionFailure
  );
});

async function legacyCiphertext(value: unknown, secret: Awaited<ReturnType<typeof createRoomSecret>>, aad: unknown) {
  const key = await crypto.subtle.importKey("raw", Buffer.from(secret.rawKey, "base64"), { name: "AES-GCM" }, false, [
    "encrypt"
  ]);
  const nonce = new Uint8Array(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(JSON.stringify(aad)) },
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

test("version 2 room, local, and attachment ciphertext remains readable", async () => {
  const secret = await createRoomSecret();
  const roomPayload = await legacyCiphertext({ legacy: "room" }, secret, {
    domain: "multaiplayer:room-envelope:v2",
    ...metadata
  });
  assert.deepEqual(await decryptJson(roomPayload, secret, metadata), { legacy: "room" });

  const localContext = {
    purpose: "room-history" as const,
    roomId: "room-legacy",
    keyEpoch: 2,
    savedAt: "2026-07-10T12:00:00.000Z"
  };
  const localPayload = await legacyCiphertext({ legacy: "local" }, secret, {
    domain: "multaiplayer:local-json:v2",
    ...localContext
  });
  assert.deepEqual(await decryptLocalJson(localPayload, secret, localContext), { legacy: "local" });

  const attachmentContext = {
    teamId: "team-1",
    roomId: "room-1",
    name: "legacy.txt",
    type: "text/plain",
    size: 6
  };
  const attachmentPayload = await legacyCiphertext({ legacy: "attachment" }, secret, {
    domain: "multaiplayer:attachment:v2",
    ...attachmentContext
  });
  assert.deepEqual(await decryptAttachmentJson(attachmentPayload, secret, attachmentContext), {
    legacy: "attachment"
  });
});

test("room ciphertext authenticates all envelope metadata", async () => {
  const secret = await createRoomSecret();
  const payload = await encryptJson({ message: "bound" }, secret, metadata);
  for (const changed of [
    { ...metadata, senderUserId: "attacker" },
    { ...metadata, roomId: "other-room" },
    { ...metadata, kind: "chat.edit" as const },
    { ...metadata, keyEpoch: 2 },
    { ...metadata, createdAt: "2026-07-10T12:00:01.000Z" }
  ]) {
    await assert.rejects(() => decryptJson(payload, secret, changed), decryptionFailure);
  }
});

test("device-sealed payload rejects ciphertext tampering", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const sealed = await sealJsonToDevice({ private: "invite" }, recipient.publicKeyJwk, deviceContext);

  await assert.rejects(
    () =>
      openDeviceSealedJson(
        { ...sealed, ciphertext: flipBase64Bit(sealed.ciphertext) },
        recipient.privateKeyJwk,
        deviceContext
      ),
    decryptionFailure
  );
});

test("wrapped room secret rejects ciphertext tampering", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const wrapped = await wrapRoomSecretForDevice(await createRoomSecret(), recipient.publicKeyJwk, deviceContext);

  await assert.rejects(
    () =>
      unwrapRoomSecretForDevice(
        { ...wrapped, ciphertext: flipBase64Bit(wrapped.ciphertext) },
        recipient.privateKeyJwk,
        deviceContext
      ),
    decryptionFailure
  );
});

test("device seal and room-secret wrap contexts cannot be interchanged", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const sealed = await sealJsonToDevice(secret, recipient.publicKeyJwk, deviceContext);
  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk, deviceContext);

  await assert.rejects(() => openDeviceSealedJson(wrapped, recipient.privateKeyJwk, deviceContext), decryptionFailure);
  await assert.rejects(
    () => unwrapRoomSecretForDevice({ ...sealed, version: 1 }, recipient.privateKeyJwk, deviceContext),
    decryptionFailure
  );
});

test("crypto entry points reject malformed base64 payloads cleanly", async () => {
  const secret = await createRoomSecret();
  const recipient = await createDeviceKeyAgreementIdentity();
  const encrypted = await encryptJson({ hello: "room" }, secret, metadata);
  const sealed = await sealJsonToDevice({ hello: "device" }, recipient.publicKeyJwk, deviceContext);
  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk, deviceContext);

  await assert.rejects(
    () => decryptJson({ ...encrypted, ciphertext: "%%%" }, secret, metadata),
    /Invalid base64 encoding/
  );
  await assert.rejects(
    () => openDeviceSealedJson({ ...sealed, nonce: "%%%" }, recipient.privateKeyJwk, deviceContext),
    /Invalid base64 encoding/
  );
  await assert.rejects(
    () => unwrapRoomSecretForDevice({ ...wrapped, ciphertext: "%%%" }, recipient.privateKeyJwk, deviceContext),
    /Invalid base64 encoding/
  );
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
    await assert.rejects(() => sealJsonToDevice({ private: "invite" }, malformedKey, deviceContext));
    await assert.rejects(() =>
      wrapRoomSecretForDevice({ algorithm: "AES-GCM-256", rawKey: "A".repeat(43) + "=" }, malformedKey, deviceContext)
    );
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
    "sha256:c71d:0170:0fb0:3288:70f1:ab58:0c93:9eea:9786:3287:6494:6db0:4470:655c:732f:9743"
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
