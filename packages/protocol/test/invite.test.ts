import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InviteJoinRequestPlaintextPayload,
  InviteJoinStatusPlaintextPayload,
  HostHandoffPlaintextPayload,
  RelayEnvelope,
  RoomSettingsPlaintextPayload,
  RoomKeyRotationPlaintextPayload,
  TeamMemberRecord,
  TeamRecord
} from "../src/index";

test("team records can carry the current user's role", () => {
  const parsed = TeamRecord.parse({
    id: "team-core",
    name: "Core Team",
    members: 4,
    role: "owner"
  });

  assert.equal(parsed.role, "owner");
});

test("team member records carry role and join metadata", () => {
  const parsed = TeamMemberRecord.parse({
    teamId: "team-core",
    userId: "github:maddiedreese",
    role: "admin",
    joinedAt: "2026-07-04T12:00:00.000Z"
  });

  assert.equal(parsed.role, "admin");
});

test("host handoff payloads can report room-visible acceptance", () => {
  const parsed = HostHandoffPlaintextPayload.parse({
    id: "handoff-1",
    fromHost: "Maddie",
    fromUserId: "github:maddie",
    projectPath: "/tmp/multaiplayer",
    codexModel: "gpt-5.4",
    approvalPolicy: "ask_every_turn",
    messagesSinceLastCodex: 2,
    attachmentNames: [],
    terminals: ["tests"],
    createdAt: "2026-07-04T12:00:00.000Z",
    status: "accepted",
    acceptedBy: "Alex",
    acceptedByUserId: "github:alex",
    acceptedAt: "2026-07-04T12:05:00.000Z"
  });

  assert.equal(parsed.status, "accepted");
  assert.equal(parsed.acceptedBy, "Alex");
});

test("room settings payloads can report model changes", () => {
  const parsed = RoomSettingsPlaintextPayload.parse({
    eventType: "room.settings",
    id: "settings-1",
    setting: "codexModel",
    previousValue: "gpt-5.4",
    nextValue: "gpt-5.4-thinking",
    changedBy: "Maddie",
    changedByUserId: "github:maddie",
    changedAt: "2026-07-04T12:00:00.000Z"
  });

  assert.equal(parsed.setting, "codexModel");
  assert.equal(parsed.nextValue, "gpt-5.4-thinking");
});

test("room settings payloads cover host-controlled room settings", () => {
  const settings = [
    "approvalPolicy",
    "roomMode",
    "codexModel",
    "projectPath",
    "browserAllowedOrigins",
    "browserProfilePersistent"
  ];

  for (const setting of settings) {
    const parsed = RoomSettingsPlaintextPayload.parse({
      eventType: "room.settings",
      id: `settings-${setting}`,
      setting,
      previousValue: "before",
      nextValue: "after",
      changedBy: "Maddie",
      changedByUserId: "github:maddie",
      changedAt: "2026-07-04T12:00:00.000Z"
    });

    assert.equal(parsed.setting, setting);
  }
});

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

test("room key rotation payload carries a new room secret", () => {
  const parsed = RoomKeyRotationPlaintextPayload.parse({
    eventType: "room.key.rotated",
    id: "rotation-1",
    rotatedBy: "Host",
    rotatedByUserId: "github:host",
    rotatedAt: "2026-07-04T12:03:00.000Z",
    newSecret: {
      algorithm: "AES-GCM-256",
      rawKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    },
    note: "Future messages use this key."
  });

  assert.equal(parsed.newSecret.algorithm, "AES-GCM-256");
});

test("relay envelope accepts encrypted room key rotation events", () => {
  const parsed = RelayEnvelope.parse({
    id: "envelope-rotation",
    teamId: "team-1",
    roomId: "room-1",
    senderDeviceId: "device_12345678",
    senderUserId: "github:maddie",
    createdAt: "2026-07-04T12:04:00.000Z",
    kind: "room.key",
    payload: {
      algorithm: "AES-GCM-256",
      nonce: "nonce",
      ciphertext: "ciphertext"
    }
  });

  assert.equal(parsed.kind, "room.key");
});
