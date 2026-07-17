import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerRoomCreateRoute } from "../../src/http/room-create-route.js";
import { registerAttachmentRoutes } from "../../src/http/attachments.js";
import { registerTeamRoutes } from "../../src/http/teams.js";
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
    scheduleStoreSave: () => assert.fail("capacity rejection must happen before persistence"),
    saveRelayStore: async () => assert.fail("capacity rejection must happen before persistence"),
    broadcastRoomUpdated: () => assert.fail("capacity rejection must not broadcast"),
    isApprovalPolicy: (value): value is "ask_every_turn" => value === "ask_every_turn",
    normalizeMetadataText: boundedText,
    displayNameForUser: () => "Capacity",
    maxHostNameChars: 120,
    maxRoomNameChars: 120
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
