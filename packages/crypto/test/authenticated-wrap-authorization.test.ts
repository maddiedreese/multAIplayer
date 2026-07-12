import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeviceKeyAgreementIdentity,
  createRoomSecret,
  unwrapRoomSecretAuthenticatedFromDevice,
  wrapRoomSecretAuthenticatedForDevice,
  type DeviceCryptoContext
} from "../src/index.js";

const inviteContext: DeviceCryptoContext = {
  purpose: "invite-response",
  teamId: "team-1",
  roomId: "room-1",
  senderUserId: "host-user",
  senderDeviceId: "host-device",
  recipientDeviceId: "peer-device",
  requestId: "request-1",
  requestNonce: "nonce-1",
  keyEpoch: 1
};

const rotationContext: DeviceCryptoContext = {
  purpose: "room-key-rotation",
  teamId: "team-1",
  roomId: "room-1",
  senderUserId: "host-user",
  senderDeviceId: "host-device",
  recipientDeviceId: "peer-device",
  operationId: "rotation-1",
  keyEpoch: 1,
  previousEpoch: 1,
  newEpoch: 2
};

async function fixture() {
  const sender = await createDeviceKeyAgreementIdentity();
  const recipient = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  return { sender, recipient, secret };
}

test("invite-response authorization rejects every incomplete or invalid epoch state", async () => {
  const { sender, recipient, secret } = await fixture();
  const invalidContexts: DeviceCryptoContext[] = [
    { ...inviteContext, requestId: undefined },
    { ...inviteContext, requestId: "" },
    { ...inviteContext, requestNonce: undefined },
    { ...inviteContext, requestNonce: "" },
    { ...inviteContext, requestId: undefined, requestNonce: undefined },
    { ...inviteContext, keyEpoch: undefined },
    ...[0, -1, 1.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1].map((keyEpoch) => ({
      ...inviteContext,
      keyEpoch
    }))
  ];

  for (const context of invalidContexts) {
    await assert.rejects(
      wrapRoomSecretAuthenticatedForDevice(secret, sender, recipient.publicKeyJwk, context),
      /Invite response wrap requires|positive safe integer/
    );
  }
});

test("invite-response authorization accepts boundary epochs and round-trips", async () => {
  const { sender, recipient, secret } = await fixture();
  for (const keyEpoch of [1, Number.MAX_SAFE_INTEGER]) {
    const context = { ...inviteContext, keyEpoch };
    const wrapped = await wrapRoomSecretAuthenticatedForDevice(secret, sender, recipient.publicKeyJwk, context);
    assert.deepEqual(
      await unwrapRoomSecretAuthenticatedFromDevice(wrapped, recipient.privateKeyJwk, sender.publicKeyJwk, context),
      secret
    );
  }
});

test("rotation authorization rejects every invalid transition state", async () => {
  const { sender, recipient, secret } = await fixture();
  const invalidContexts: DeviceCryptoContext[] = [
    { ...rotationContext, operationId: undefined },
    { ...rotationContext, operationId: "" },
    { ...rotationContext, previousEpoch: undefined },
    { ...rotationContext, newEpoch: 1 },
    { ...rotationContext, newEpoch: 0 },
    { ...rotationContext, newEpoch: 3 },
    { ...rotationContext, keyEpoch: 2 },
    { ...rotationContext, keyEpoch: undefined },
    { ...rotationContext, previousEpoch: 0, keyEpoch: 0, newEpoch: 1 },
    { ...rotationContext, previousEpoch: 1.5, keyEpoch: 1.5, newEpoch: 2.5 },
    {
      ...rotationContext,
      previousEpoch: Number.MAX_SAFE_INTEGER,
      keyEpoch: Number.MAX_SAFE_INTEGER,
      newEpoch: Number.MAX_SAFE_INTEGER + 1
    },
    {
      ...rotationContext,
      previousEpoch: Number.MAX_SAFE_INTEGER,
      keyEpoch: Number.MAX_SAFE_INTEGER,
      newEpoch: Number.MAX_SAFE_INTEGER
    }
  ];

  for (const context of invalidContexts) {
    await assert.rejects(
      wrapRoomSecretAuthenticatedForDevice(secret, sender, recipient.publicKeyJwk, context),
      /Rotation wrap requires|positive safe integer/
    );
  }
});

test("rotation authorization accepts boundary transitions and round-trips", async () => {
  const { sender, recipient, secret } = await fixture();
  for (const [previousEpoch, newEpoch] of [
    [1, 2],
    [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]
  ] as const) {
    const context = { ...rotationContext, keyEpoch: previousEpoch, previousEpoch, newEpoch };
    const wrapped = await wrapRoomSecretAuthenticatedForDevice(secret, sender, recipient.publicKeyJwk, context);
    assert.deepEqual(
      await unwrapRoomSecretAuthenticatedFromDevice(wrapped, recipient.privateKeyJwk, sender.publicKeyJwk, context),
      secret
    );
  }
});

test("authenticated wraps reject unsupported purposes", async () => {
  const { sender, recipient, secret } = await fixture();
  for (const purpose of ["invite-request", "unsupported"]) {
    await assert.rejects(
      wrapRoomSecretAuthenticatedForDevice(secret, sender, recipient.publicKeyJwk, {
        ...inviteContext,
        purpose: purpose as DeviceCryptoContext["purpose"]
      }),
      /Authenticated room-secret wraps require/
    );
  }
});

test("authenticated wrap ciphertext binds every context field", async () => {
  const { sender, recipient, secret } = await fixture();
  const wrapped = await wrapRoomSecretAuthenticatedForDevice(secret, sender, recipient.publicKeyJwk, inviteContext);
  const changes: Partial<Record<keyof DeviceCryptoContext, DeviceCryptoContext[keyof DeviceCryptoContext]>> = {
    purpose: "room-key-rotation",
    teamId: "team-2",
    roomId: "room-2",
    senderUserId: "host-user-2",
    senderDeviceId: "host-device-2",
    recipientDeviceId: "peer-device-2",
    operationId: "operation-2",
    requestId: "request-2",
    requestNonce: "nonce-2",
    keyEpoch: 2,
    previousEpoch: 1,
    newEpoch: 2
  };

  for (const [field, replacement] of Object.entries(changes)) {
    await assert.rejects(
      unwrapRoomSecretAuthenticatedFromDevice(wrapped, recipient.privateKeyJwk, sender.publicKeyJwk, {
        ...inviteContext,
        [field]: replacement
      } as DeviceCryptoContext)
    );
  }
});

test("authenticated wrap envelopes enforce v3 and their algorithm discriminant", async () => {
  const { sender, recipient, secret } = await fixture();
  const wrapped = await wrapRoomSecretAuthenticatedForDevice(secret, sender, recipient.publicKeyJwk, inviteContext);
  for (const version of [0, 1, 2, 4, 1.5]) {
    await assert.rejects(
      unwrapRoomSecretAuthenticatedFromDevice(
        { ...wrapped, version } as typeof wrapped,
        recipient.privateKeyJwk,
        sender.publicKeyJwk,
        inviteContext
      ),
      /Unsupported authenticated room-secret wrap version/
    );
  }
  await assert.rejects(
    unwrapRoomSecretAuthenticatedFromDevice(
      { ...wrapped, algorithm: "AES-GCM-256" } as unknown as typeof wrapped,
      recipient.privateKeyJwk,
      sender.publicKeyJwk,
      inviteContext
    ),
    /Unsupported authenticated room-secret wrap algorithm/
  );
});
