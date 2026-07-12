import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeviceKeyAgreementIdentity,
  createRoomSecret,
  sameDevicePublicKey,
  unwrapRoomSecretAuthenticatedFromDevice,
  wrapRoomSecretAuthenticatedForDevice,
  type DeviceCryptoContext
} from "../src/index.js";

const context: DeviceCryptoContext = {
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

test("device public-key pinning compares both coordinates and ignores serialization metadata", async () => {
  const identity = await createDeviceKeyAgreementIdentity();
  const other = await createDeviceKeyAgreementIdentity();
  const reordered = {
    y: identity.publicKeyJwk.y,
    key_ops: [],
    x: identity.publicKeyJwk.x,
    ext: false,
    crv: identity.publicKeyJwk.crv,
    kty: identity.publicKeyJwk.kty
  };

  assert.equal(sameDevicePublicKey(identity.publicKeyJwk, reordered), true);
  assert.equal(sameDevicePublicKey(identity.publicKeyJwk, { ...reordered, x: other.publicKeyJwk.x }), false);
  assert.equal(sameDevicePublicKey(identity.publicKeyJwk, { ...reordered, y: other.publicKeyJwk.y }), false);
  for (const malformed of [
    null,
    {},
    { ...reordered, x: "" },
    { ...reordered, y: "" },
    { ...reordered, d: "private" }
  ]) {
    assert.equal(sameDevicePublicKey(identity.publicKeyJwk, malformed as JsonWebKey), false);
    assert.equal(sameDevicePublicKey(malformed as JsonWebKey, identity.publicKeyJwk), false);
  }
});

test("authenticated unwrap rejects substituted and malformed pinned host keys", async () => {
  const sender = await createDeviceKeyAgreementIdentity();
  const recipient = await createDeviceKeyAgreementIdentity();
  const other = await createDeviceKeyAgreementIdentity();
  const secret = await createRoomSecret();
  const wrapped = await wrapRoomSecretAuthenticatedForDevice(secret, sender, recipient.publicKeyJwk, context);

  for (const expectedSender of [
    { ...sender.publicKeyJwk, x: other.publicKeyJwk.x },
    { ...sender.publicKeyJwk, y: other.publicKeyJwk.y },
    {},
    { ...sender.publicKeyJwk, x: "" },
    { ...sender.publicKeyJwk, d: "private" }
  ]) {
    await assert.rejects(
      unwrapRoomSecretAuthenticatedFromDevice(wrapped, recipient.privateKeyJwk, expectedSender, context),
      /sender key does not match|Expected exported ECDH public key material/
    );
  }

  assert.deepEqual(
    await unwrapRoomSecretAuthenticatedFromDevice(
      wrapped,
      recipient.privateKeyJwk,
      { ...sender.publicKeyJwk, key_ops: [], ext: false },
      context
    ),
    secret
  );
});
