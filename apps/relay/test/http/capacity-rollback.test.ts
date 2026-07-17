import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerRoomCreateRoute } from "../../src/http/room-create-route.js";
import { registerAttachmentRoutes } from "../../src/http/attachments.js";
import { registerTeamRoutes } from "../../src/http/teams.js";
import { registerDeviceRetirementRoute } from "../../src/http/device-retirement.js";
import { createRelayStore } from "../../src/state.js";

const session = {
  sessionIdHash: "a".repeat(64),
  user: { id: "github:capacity", login: "capacity" },
  expiresAt: Date.now() + 60 * 60_000
};

test("team creation rolls back its quota and team when member capacity is exhausted", async () => {
  const store = createRelayStore(2);
  store.authSessions.set(session.sessionIdHash, session);
  const app = express();
  app.use(express.json());
  registerTeamRoutes({
    app,
    store,
    getAuthSession: () => session,
    allowRead: () => true,
    allowMutation: () => true,
    teamIdsForUser: () => new Set(),
    isTeamMember: () => false,
    teamRoleRank: () => 0,
    canSetTeamMemberRole: () => false,
    canRemoveTeamMember: () => false,
    transferTeamOwnership: (members) => members,
    revokeTeamInvites: () => {},
    revokeTeamMemberSessions: () => {},
    broadcastWorkspaceUpdated: () => assert.fail("capacity rejection must not broadcast"),
    broadcastRoomUpdated: () => assert.fail("capacity rejection must not broadcast"),
    scheduleStoreSave: () => assert.fail("capacity rejection must happen before persistence"),
    saveRelayStore: async () => assert.fail("capacity rejection must happen before persistence"),
    normalizeMetadataText: boundedText,
    maxTeamNameChars: 120
  });
  const server = await listen(app);
  try {
    const response = await fetch(`${baseUrl(server)}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "No capacity" })
    });
    assert.equal(response.status, 507);
    assert.deepEqual(await response.json(), {
      error: "Relay durable capacity is exhausted.",
      code: "capacity_exceeded",
      capacity: { resource: "durable_entries", scope: "relay", limit: 2 }
    });
    assert.equal(store.teams.size, 0);
    assert.equal(store.teamMembers.size, 0);
    assert.equal(store.accountQuotaRecords.size, 0);
  } finally {
    await close(server);
  }
});

test("ownership transfer rolls back and never broadcasts when persistence fails", async () => {
  const store = createRelayStore();
  store.setTeam({ id: "team", name: "Team", members: 2 });
  store.setTeamMembers(
    "team",
    new Map([
      [session.user.id, { teamId: "team", userId: session.user.id, role: "owner", joinedAt: new Date().toISOString() }],
      ["github:next", { teamId: "team", userId: "github:next", role: "member", joinedAt: new Date().toISOString() }]
    ])
  );
  store.authSessions.set(session.sessionIdHash, session);
  store.discardDurableMutations();
  const app = express();
  app.use(express.json());
  registerTeamRoutes({
    app,
    store,
    getAuthSession: () => session,
    allowRead: () => true,
    allowMutation: () => true,
    teamIdsForUser: () => new Set(["team"]),
    isTeamMember: () => true,
    teamRoleRank: () => 0,
    canSetTeamMemberRole: () => true,
    canRemoveTeamMember: () => true,
    transferTeamOwnership: (members, nextOwnerUserId) => {
      const previousOwner = members.get(session.user.id)!;
      const nextOwner = members.get(nextOwnerUserId)!;
      members.set(session.user.id, { ...previousOwner, role: "admin" });
      members.set(nextOwnerUserId, { ...nextOwner, role: "owner" });
      return members;
    },
    revokeTeamInvites: () => {},
    revokeTeamMemberSessions: () => {},
    broadcastWorkspaceUpdated: () => assert.fail("failed persistence must not broadcast"),
    broadcastRoomUpdated: () => {},
    scheduleStoreSave: () => {
      throw new Error("disk full");
    },
    saveRelayStore: async () => {},
    normalizeMetadataText: boundedText,
    maxTeamNameChars: 120
  });
  const server = await listen(app);
  try {
    const response = await fetch(`${baseUrl(server)}/teams/team/members/github:next/transfer-owner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(response.status, 503);
    assert.equal(store.getTeamMember("team", session.user.id)?.role, "owner");
    assert.equal(store.getTeamMember("team", "github:next")?.role, "member");
  } finally {
    await close(server);
  }
});

test("room creation rolls back its durable quota when capacity rejects the room", async () => {
  const store = createRelayStore(2);
  store.authSessions.set(session.sessionIdHash, session);
  store.setTeam({ id: "team-capacity", name: "Capacity", members: 1 });
  store.discardDurableMutations();
  const app = express();
  app.use(express.json());
  registerRoomCreateRoute({
    app,
    store,
    getAuthSession: () => session,
    allowMutation: () => true,
    teamIdsForUser: () => new Set(["team-capacity"]),
    isTeamMember: () => true,
    canAccessRoom: () => true,
    scheduleStoreSave: () => assert.fail("capacity rejection must happen before persistence"),
    saveRelayStore: async () => assert.fail("capacity rejection must happen before persistence"),
    broadcastRoomUpdated: () => assert.fail("capacity rejection must not broadcast"),
    requesterFromRequest: () => ({ id: session.user.id, name: session.user.login }),
    isRoomHost: () => false,
    isApprovalPolicy: (value): value is "ask_every_turn" => value === "ask_every_turn",
    normalizeMetadataText: boundedText,
    normalizeOptionalMetadataText: boundedText,
    displayNameForUser: () => "Capacity",
    maxDeviceIdChars: 160,
    maxHostNameChars: 120,
    maxRoomNameChars: 120,
    maxUserIdChars: 160,
    deviceAuthRequired: false
  });
  const server = await listen(app);
  try {
    const response = await fetch(`${baseUrl(server)}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamId: "team-capacity", name: "No capacity" })
    });
    assert.equal(response.status, 507);
    assert.deepEqual(await response.json(), {
      error: "Relay durable capacity is exhausted.",
      code: "capacity_exceeded",
      capacity: { resource: "durable_entries", scope: "relay", limit: 2 }
    });
    assert.equal(store.rooms.size, 0);
    assert.equal(store.accountQuotaRecords.size, 0);
  } finally {
    await close(server);
  }
});

test("attachment upload rolls back its byte quota when real retained bytes exhaust capacity", async () => {
  const store = createRelayStore(100, 100, {
    mlsBacklog: { global: 1_000, perTeam: 1_000, perRoom: 1_000 },
    attachmentBlobs: { global: 1, perTeam: 1 }
  });
  store.authSessions.set(session.sessionIdHash, session);
  store.setTeam({ id: "team-capacity", name: "Capacity", members: 1 });
  store.setRoom({
    id: "room-capacity",
    teamId: "team-capacity",
    name: "Capacity",
    host: "Capacity",
    hostStatus: "active",
    approvalPolicy: "ask_every_turn"
  });
  store.discardDurableMutations();
  const app = express();
  app.use(express.json());
  registerAttachmentRoutes({
    app,
    store,
    attachmentBlobMaxBytes: 1024,
    attachmentBlobLiveQuotaBytes: 4096,
    attachmentBlobTeamLiveQuotaBytes: 4096,
    attachmentBlobUploadBytesPerWindow: 4096,
    attachmentBlobUploadWindowMs: 60_000,
    attachmentBlobTtlDays: 1,
    maxAttachmentBlobNameChars: 512,
    maxAttachmentBlobTypeChars: 120,
    getAuthSession: () => session,
    allowRead: () => true,
    allowMutation: () => true,
    canAccessRoom: () => true,
    scheduleStoreSave: () => assert.fail("capacity rejection must happen before persistence"),
    saveRelayStore: async () => assert.fail("capacity rejection must happen before persistence"),
    normalizeMetadataText: boundedText,
    maxCiphertextCharactersForBlob: () => 4096,
    isExpiredAttachmentBlob: () => false
  });
  const server = await listen(app);
  try {
    const sealedBlob = JSON.stringify({
      version: 1,
      epoch: 0,
      nonce: Buffer.alloc(12, 1).toString("base64"),
      ciphertext: Buffer.from("ciphertext").toString("base64")
    });
    const response = await fetch(`${baseUrl(server)}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        blobId: "blob-capacity",
        teamId: "team-capacity",
        roomId: "room-capacity",
        name: "asset",
        type: "file",
        size: 32,
        epoch: 0,
        sealedBlob
      })
    });
    assert.equal(response.status, 507);
    assert.deepEqual(await response.json(), {
      error: "Relay durable capacity is exhausted.",
      code: "capacity_exceeded",
      capacity: { resource: "attachment_blobs", scope: "relay", limit: 1 }
    });
    assert.equal(store.attachmentBlobs.size, 0);
    assert.equal(store.accountQuotaRecords.size, 0);
  } finally {
    await close(server);
  }
});

test("device retirement restores durable and authentication state when persistence fails", async () => {
  const store = createRelayStore();
  const userId = session.user.id;
  const deviceId = "rollback-device";
  store.authSessions.set(session.sessionIdHash, session);
  store.setDevice({
    userId,
    deviceId,
    displayName: "Rollback device",
    signaturePublicKey: "AA==",
    signatureKeyFingerprint: `sha256:${"0".repeat(64)}`,
    hpkePublicKey: "AA==",
    hpkeKeyFingerprint: `sha256:${"1".repeat(64)}`,
    registeredAt: "2026-07-16T00:00:00.000Z",
    lastSeenAt: "2026-07-16T00:00:00.000Z"
  });
  store.deviceSessions.set("rollback-token", {
    token: "rollback-token",
    userId,
    deviceId,
    expiresAt: Date.now() + 60_000
  });
  store.deviceChallenges.set("rollback-challenge", { userId, deviceId, expiresAt: Date.now() + 60_000 });
  store.setKeyPackage({
    id: "rollback-package",
    userId,
    deviceId,
    keyPackage: "AA==",
    keyPackageHash: `sha256:${"2".repeat(64)}`,
    ciphersuite: 2,
    credentialIdentity: userId,
    createdAt: "2026-07-16T00:00:00.000Z"
  });
  store.consumedKeyPackages.set(`sha256:${"3".repeat(64)}`, {
    keyPackageHash: `sha256:${"3".repeat(64)}`,
    teamId: "team",
    userId,
    deviceId,
    consumedAt: "2026-07-16T00:00:00.000Z"
  });
  store.invites.set("rollback-invite", {
    id: "rollback-invite",
    teamId: "team",
    roomId: "room",
    createdAt: "2026-07-16T00:00:00.000Z"
  });
  store.inviteRequests.set("rollback-request", {
    requestId: "rollback-request",
    inviteId: "rollback-invite",
    requesterUserId: userId,
    requesterDeviceId: deviceId,
    keyPackageId: "rollback-package",
    keyPackageHash: `sha256:${"2".repeat(64)}`,
    sealedRequest: "AA==",
    createdAt: "2026-07-16T00:00:00.000Z"
  });
  store.inviteResponses.set("rollback-request", {
    requestId: "rollback-request",
    inviteId: "rollback-invite",
    requesterUserId: userId,
    requesterDeviceId: deviceId,
    keyPackageHash: `sha256:${"2".repeat(64)}`,
    status: "denied",
    responseBinding: { teamId: "team", hostUserId: "github:host", hostDeviceId: "host-device" }
  } as never);
  store.inviteAckReceipts.set("rollback-request", {
    inviteId: "rollback-invite",
    requestId: "rollback-request",
    teamId: "team",
    requesterUserId: userId,
    requesterDeviceId: deviceId,
    keyPackageHash: `sha256:${"2".repeat(64)}`,
    status: "denied",
    acknowledgedAt: "2026-07-16T00:00:00.000Z",
    expiresAt: "2026-07-17T00:00:00.000Z"
  });
  store.discardDurableMutations();

  const app = express();
  app.use(express.json());
  registerDeviceRetirementRoute({
    app,
    store,
    getAuthSession: () => session,
    allowMutation: () => true,
    saveRelayStore: async () => {
      throw new Error("disk full");
    },
    revokeDeviceSessions: () => assert.fail("failed persistence must not revoke live sockets"),
    normalizeMetadataText: boundedText,
    maxDeviceIdChars: 160
  });
  const server = await listen(app);
  try {
    const response = await fetch(`${baseUrl(server)}/devices/${deviceId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-device-session": "rollback-token" },
      body: JSON.stringify({ confirmation: deviceId })
    });
    assert.equal(response.status, 503);
    assert.ok(store.getDevice(userId, deviceId));
    assert.ok(store.deviceSessions.has("rollback-token"));
    assert.ok(store.deviceChallenges.has("rollback-challenge"));
    assert.ok(store.keyPackages.has("rollback-package"));
    assert.equal(store.consumedKeyPackages.size, 1, "replay tombstones are never retired");
    assert.ok(store.invites.has("rollback-invite"));
    assert.ok(store.inviteRequests.has("rollback-request"));
    assert.ok(store.inviteResponses.has("rollback-request"));
    assert.ok(store.inviteAckReceipts.has("rollback-request"));
  } finally {
    await close(server);
  }
});

test("device retirement removes only device-bound invite artifacts", async () => {
  const store = createRelayStore();
  const userId = session.user.id;
  const deviceId = "invite-device";
  store.authSessions.set(session.sessionIdHash, session);
  store.setDevice({
    userId,
    deviceId,
    displayName: "Invite device",
    signaturePublicKey: "AA==",
    signatureKeyFingerprint: `sha256:${"0".repeat(64)}`,
    hpkePublicKey: "AA==",
    hpkeKeyFingerprint: `sha256:${"1".repeat(64)}`,
    registeredAt: "2026-07-16T00:00:00.000Z",
    lastSeenAt: "2026-07-16T00:00:00.000Z"
  });
  store.invites.set("pending-invite", {
    id: "pending-invite",
    teamId: "team",
    roomId: "room",
    createdAt: "2026-07-16T00:00:00.000Z"
  });
  store.inviteRequests.set("pending-request", {
    requestId: "pending-request",
    inviteId: "pending-invite",
    requesterUserId: userId,
    requesterDeviceId: deviceId,
    keyPackageId: "pending-package",
    keyPackageHash: `sha256:${"2".repeat(64)}`,
    sealedRequest: "AA==",
    createdAt: "2026-07-16T00:00:00.000Z"
  });
  store.invites.set("approved-invite", {
    id: "approved-invite",
    teamId: "team",
    roomId: "room",
    approvedUserId: userId,
    approvedDeviceId: deviceId,
    keyPackageHash: `sha256:${"2".repeat(64)}`,
    createdAt: "2026-07-16T00:00:00.000Z"
  });
  store.discardDurableMutations();

  let revoked = false;
  const app = express();
  app.use(express.json());
  registerDeviceRetirementRoute({
    app,
    store,
    getAuthSession: () => session,
    allowMutation: () => true,
    saveRelayStore: async () => {},
    revokeDeviceSessions: () => {
      revoked = true;
    },
    normalizeMetadataText: boundedText,
    maxDeviceIdChars: 160
  });
  const server = await listen(app);
  try {
    const response = await fetch(`${baseUrl(server)}/devices/${deviceId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: deviceId })
    });
    assert.equal(response.status, 200);
    assert.equal(store.invites.has("pending-invite"), true, "the host-owned reusable invite must remain");
    assert.equal(store.inviteRequests.has("pending-request"), false);
    assert.equal(store.invites.has("approved-invite"), false, "approval bound to the retired device must be revoked");
    assert.equal(revoked, true);
  } finally {
    await close(server);
  }
});

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

async function listen(app: express.Express) {
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

function baseUrl(server: Awaited<ReturnType<typeof listen>>) {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function close(server: Awaited<ReturnType<typeof listen>>) {
  return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
