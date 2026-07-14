import assert from "node:assert/strict";
import test from "node:test";
import { parseStrictDirectedInviteRequestJson } from "../src/opaque.js";

test("relay accepts the canonical native durable invite envelope", () => {
  const binding = {
    version: 3,
    phase: "request",
    inviteId: "invite-native",
    teamId: "team-native",
    roomId: "room-native",
    keyEpoch: 0,
    keyPackageHash: `sha256:${"a".repeat(64)}`,
    requestId: "request-native",
    requestNonce: "request_nonce_1234",
    requesterUserId: "github:joiner",
    requesterDeviceId: "device-joiner",
    hostUserId: "github:host",
    hostDeviceId: "device-host",
    expiresAt: "2030-01-01T00:00:00.000Z",
    status: null,
    decidedAt: null
  } as const;
  const sealedPayload = {
    version: 1,
    kem_id: 16,
    kdf_id: 1,
    aead_id: 1,
    encapsulated_key: Array(65).fill(0),
    ciphertext: Array(16).fill(0)
  };
  const nativeEnvelope = JSON.stringify({ version: 3, binding, sealedPayload });

  assert.deepEqual(parseStrictDirectedInviteRequestJson(nativeEnvelope, 1_400_000), {
    version: 3,
    binding,
    sealedPayload
  });
  assert.equal(
    parseStrictDirectedInviteRequestJson(JSON.stringify({ binding, sealedPayload, version: 3 }), 1_400_000),
    null,
    "the relay must continue rejecting non-canonical top-level field order"
  );
});
