import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InviteJoinRequestPlaintextPayload,
  InviteJoinStatusPlaintextPayload,
  RelayEnvelope
} from "../src/index";

test("invite join request accepts optional requester device public key", () => {
  const parsed = InviteJoinRequestPlaintextPayload.parse({
    eventType: "invite.request",
    id: "device_12345678:request",
    inviteId: "invite-1",
    requester: "Maddie",
    requesterUserId: "github:maddie",
    requesterDeviceId: "device_12345678",
    requesterPublicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: "x-coordinate",
      y: "y-coordinate"
    },
    requesterPublicKeyFingerprint: "1111:2222:3333:4444:5555:6666:7777:8888",
    requestedAt: "2026-07-04T12:00:00.000Z",
    note: "Requesting access."
  });

  assert.equal(parsed.requesterPublicKeyJwk.kty, "EC");
});

test("invite status accepts optional device-wrapped room secret", () => {
  const parsed = InviteJoinStatusPlaintextPayload.parse({
    eventType: "invite.status",
    requestId: "device_12345678:request",
    status: "approved",
    decidedBy: "Host",
    decidedByUserId: "github:host",
    decidedAt: "2026-07-04T12:01:00.000Z",
    recipientDeviceId: "device_12345678",
    recipientPublicKeyFingerprint: "1111:2222:3333:4444:5555:6666:7777:8888",
    wrappedRoomSecret: {
      version: 1,
      algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
      ephemeralPublicKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "ephemeral-x",
        y: "ephemeral-y"
      },
      nonce: "nonce",
      ciphertext: "ciphertext"
    }
  });

  assert.equal(parsed.wrappedRoomSecret?.algorithm, "ECDH-P256-HKDF-SHA256-AES-GCM-256");
});

test("legacy invite status without wrapped key remains valid", () => {
  const parsed = InviteJoinStatusPlaintextPayload.parse({
    eventType: "invite.status",
    requestId: "device_12345678:request",
    status: "denied",
    decidedBy: "Host",
    decidedByUserId: "github:host",
    decidedAt: "2026-07-04T12:01:00.000Z"
  });

  assert.equal(parsed.wrappedRoomSecret, undefined);
});

test("relay envelope accepts device-sealed invite payloads", () => {
  const parsed = RelayEnvelope.parse({
    id: "envelope-1",
    teamId: "team-1",
    roomId: "room-1",
    senderDeviceId: "device_12345678",
    senderUserId: "github:maddie",
    createdAt: "2026-07-04T12:02:00.000Z",
    kind: "room.invite",
    payload: {
      algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
      ephemeralPublicKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "ephemeral-x",
        y: "ephemeral-y"
      },
      nonce: "nonce",
      ciphertext: "ciphertext"
    }
  });

  assert.equal(parsed.payload.algorithm, "ECDH-P256-HKDF-SHA256-AES-GCM-256");
});
