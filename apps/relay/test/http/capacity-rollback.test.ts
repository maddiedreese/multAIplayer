import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerRoomCreateRoute } from "../../src/http/room-create-route.js";
import { registerAttachmentRoutes } from "../../src/http/attachments.js";
import { createRelayStore } from "../../src/state.js";

const session = {
  sessionIdHash: "a".repeat(64),
  user: { id: "github:capacity", login: "capacity" },
  expiresAt: Date.now() + 60_000
};

test("room creation rolls back its durable quota when capacity rejects the room", async () => {
  const store = createRelayStore(2);
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
    isApprovalDelegationPolicy: (value): value is "host_only" => value === "host_only",
    isRoomMode: () => true,
    normalizeMetadataText: boundedText,
    normalizeOptionalMetadataText: boundedText,
    normalizeBrowserAllowedOrigins: () => [],
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
    assert.equal(response.status, 503);
    assert.equal(store.rooms.size, 0);
    assert.equal(store.accountQuotaRecords.size, 0);
  } finally {
    await close(server);
  }
});

test("attachment upload rolls back its byte quota when capacity rejects the blob", async () => {
  const store = createRelayStore(3);
  store.setTeam({ id: "team-capacity", name: "Capacity", members: 1 });
  store.setRoom({
    id: "room-capacity",
    teamId: "team-capacity",
    name: "Capacity",
    host: "Capacity",
    hostStatus: "active",
    approvalPolicy: "ask_every_turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    mode: { chat: true, code: true, workspace: true, browser: true },
    browserAllowedOrigins: [],
    browserProfilePersistent: false,
    unread: 0
  });
  store.discardDurableMutations();
  const app = express();
  app.use(express.json());
  registerAttachmentRoutes({
    app,
    store,
    attachmentBlobMaxBytes: 1024,
    attachmentBlobLiveQuotaBytes: 4096,
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
    assert.equal(response.status, 503);
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
