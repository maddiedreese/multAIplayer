import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeviceKeyAgreementIdentity,
  createRoomSecret,
  decryptJson,
  decryptLocalJson,
  encryptJson,
  encryptLocalJson,
  openDeviceSealedJson,
  sealJsonToDevice,
  unwrapRoomSecretForDevice,
  wrapRoomSecretForDevice,
  type DeviceCryptoContext,
  type LocalCryptoContext
} from "../src/index.js";

const decryptFailure = /decrypt|operation-specific reason|operation failed|bad decrypt/i;

const deviceContext: DeviceCryptoContext = {
  purpose: "invite-request",
  teamId: "team-1",
  roomId: "room-1",
  senderUserId: "user-1",
  senderDeviceId: "device-1",
  recipientDeviceId: "device-2"
};

const localContext: LocalCryptoContext = {
  purpose: "room-history",
  roomId: "room-1",
  keyEpoch: 1,
  savedAt: "2026-07-11T12:00:00.000Z"
};

const roomMetadata = {
  id: "message-1",
  teamId: "team-1",
  roomId: "room-1",
  senderDeviceId: "device-1",
  senderUserId: "user-1",
  createdAt: "2026-07-11T12:00:00.000Z",
  kind: "chat.message" as const,
  keyEpoch: 1
};

test("device seal and room-secret wrap reject each empty required context field", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const requiredFields = [
    "purpose",
    "teamId",
    "roomId",
    "senderUserId",
    "senderDeviceId",
    "recipientDeviceId"
  ] as const;

  for (const field of requiredFields) {
    const invalid = { ...deviceContext, [field]: "" } as DeviceCryptoContext;
    const expected =
      field === "purpose"
        ? /Unsupported device crypto context purpose/
        : new RegExp(`Device crypto context ${field} must be non-empty`);
    await assert.rejects(sealJsonToDevice({ value: 1 }, recipient.publicKeyJwk, invalid), expected);
    await assert.rejects(wrapRoomSecretForDevice(secret, recipient.publicKeyJwk, invalid), expected);
  }
});

test("device seal and room-secret wrap bind every required and optional context field", async () => {
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const context: DeviceCryptoContext = {
    ...deviceContext,
    operationId: "operation-1",
    requestId: "request-1",
    requestNonce: "nonce-1",
    keyEpoch: 2,
    previousEpoch: 1,
    newEpoch: 2
  };
  const sealed = await sealJsonToDevice({ value: 1 }, recipient.publicKeyJwk, context);
  const wrapped = await wrapRoomSecretForDevice(secret, recipient.publicKeyJwk, context);
  const changes: Partial<Record<keyof DeviceCryptoContext, DeviceCryptoContext[keyof DeviceCryptoContext]>> = {
    purpose: "invite-response",
    teamId: "team-2",
    roomId: "room-2",
    senderUserId: "user-2",
    senderDeviceId: "device-3",
    recipientDeviceId: "device-4",
    operationId: "operation-2",
    requestId: "request-2",
    requestNonce: "nonce-2",
    keyEpoch: 3,
    previousEpoch: 2,
    newEpoch: 3
  };

  for (const [field, replacement] of Object.entries(changes)) {
    const changed = { ...context, [field]: replacement } as DeviceCryptoContext;
    await assert.rejects(openDeviceSealedJson(sealed, recipient.privateKeyJwk, changed), decryptFailure);
    await assert.rejects(unwrapRoomSecretForDevice(wrapped, recipient.privateKeyJwk, changed), decryptFailure);
  }

  assert.deepEqual(await openDeviceSealedJson(sealed, recipient.privateKeyJwk, context), { value: 1 });
  assert.deepEqual(await unwrapRoomSecretForDevice(wrapped, recipient.privateKeyJwk, context), secret);
});

test("local encryption validates room, timestamp, and positive safe-integer epoch boundaries", async () => {
  const secret = await createRoomSecret();
  const invalidContexts: Array<[LocalCryptoContext, RegExp]> = [
    [
      { ...localContext, purpose: "unsupported" as LocalCryptoContext["purpose"] },
      /Unsupported local crypto context purpose/
    ],
    [{ ...localContext, roomId: "" }, /roomId must be non-empty/],
    [{ ...localContext, savedAt: "" }, /savedAt must be non-empty/],
    [{ ...localContext, keyEpoch: 0 }, /keyEpoch must be a positive safe integer/],
    [{ ...localContext, keyEpoch: -1 }, /keyEpoch must be a positive safe integer/],
    [{ ...localContext, keyEpoch: 1.5 }, /keyEpoch must be a positive safe integer/],
    [{ ...localContext, keyEpoch: Number.NaN }, /keyEpoch must be a positive safe integer/],
    [{ ...localContext, keyEpoch: Infinity }, /keyEpoch must be a positive safe integer/],
    [{ ...localContext, keyEpoch: Number.MAX_SAFE_INTEGER + 1 }, /keyEpoch must be a positive safe integer/]
  ];
  for (const [invalid, expected] of invalidContexts) {
    await assert.rejects(encryptLocalJson({ value: 1 }, secret, invalid), expected);
  }

  await assert.doesNotReject(encryptLocalJson({ value: 1 }, secret, localContext));
  await assert.doesNotReject(
    encryptLocalJson({ value: 1 }, secret, { ...localContext, keyEpoch: Number.MAX_SAFE_INTEGER })
  );
});

test("local ciphertext binds every context field", async () => {
  const secret = await createRoomSecret();
  const encrypted = await encryptLocalJson({ value: 1 }, secret, localContext);
  const changedContexts: LocalCryptoContext[] = [
    { ...localContext, purpose: "room-secret-backup" },
    { ...localContext, roomId: "room-2" },
    { ...localContext, keyEpoch: 2 },
    { ...localContext, savedAt: "2026-07-11T12:00:01.000Z" }
  ];

  for (const changed of changedContexts) {
    await assert.rejects(decryptLocalJson(encrypted, secret, changed), decryptFailure);
  }
  assert.deepEqual(await decryptLocalJson(encrypted, secret, localContext), { value: 1 });
});

test("room encryption rejects missing metadata and binds every metadata field", async () => {
  const secret = await createRoomSecret();
  for (const field of Object.keys(roomMetadata) as Array<keyof typeof roomMetadata>) {
    const missing = { ...roomMetadata } as Record<string, unknown>;
    delete missing[field];
    await assert.rejects(encryptJson({ value: 1 }, secret, missing as never));
  }

  const encrypted = await encryptJson({ value: 1 }, secret, roomMetadata);
  const replacements = {
    id: "message-2",
    teamId: "team-2",
    roomId: "room-2",
    senderDeviceId: "device-2",
    senderUserId: "user-2",
    createdAt: "2026-07-11T12:00:01.000Z",
    kind: "chat.attachment" as const,
    keyEpoch: 2
  };
  for (const [field, replacement] of Object.entries(replacements)) {
    await assert.rejects(
      decryptJson(encrypted, secret, { ...roomMetadata, [field]: replacement } as never),
      decryptFailure
    );
  }
  assert.deepEqual(await decryptJson(encrypted, secret, roomMetadata), { value: 1 });
});
