import test from "node:test";
import Database from "better-sqlite3";
import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  deleteAccountOwnedRelayData,
  deleteAccountOwnedRelayDataAtomically,
  findAccountDeletionBlockers
} from "../src/auth/account-deletion.js";
import { createRelayStore } from "../src/state.js";
import { assert, createDebugSession, startRelay, waitForStoredState } from "./support/relay.js";

test("account deletion removes identity-owned records while preserving shared encrypted history", () => {
  const store = createRelayStore();
  const userId = "github:leaving";
  const otherUserId = "github:remaining";
  store.teams.set("team-shared", { id: "team-shared", name: "Shared", members: 2 });
  store.teamMembers.set(
    "team-shared",
    new Map([
      [userId, { teamId: "team-shared", userId, role: "member", joinedAt: "2026-07-01T00:00:00.000Z" }],
      [otherUserId, { teamId: "team-shared", userId: otherUserId, role: "owner", joinedAt: "2026-07-01T00:00:00.000Z" }]
    ])
  );
  store.rooms.set("room-live", room("room-live", otherUserId));
  store.rooms.set("room-deleted", { ...room("room-deleted", userId), deletedAt: "2026-07-02T00:00:00.000Z" });
  store.authSessions.set("session-leaving", {
    sessionIdHash: "session-leaving",
    user: { id: userId, login: "leaving" },
    expiresAt: Date.now() + 60_000
  });
  store.authSessions.set("session-remaining", {
    sessionIdHash: "session-remaining",
    user: { id: otherUserId, login: "remaining" },
    expiresAt: Date.now() + 60_000
  });
  store.devices.set(`${userId}:device-one`, device(userId, "device-one"));
  store.devices.set(`${otherUserId}:device-two`, device(otherUserId, "device-two"));
  store.keyPackages.set("kp-leaving", keyPackage("kp-leaving", userId, "device-one"));
  store.keyPackages.set("kp-remaining", keyPackage("kp-remaining", otherUserId, "device-two"));
  store.dailyTeamCreationCounts.set(`daily_user_team_creations:${userId}`, { count: 1, resetAt: Date.now() + 60_000 });
  store.dailyRoomCreationCounts.set(`daily_user_room_creations:${userId}`, { count: 1, resetAt: Date.now() + 60_000 });
  store.attachmentBlobUploadByteCounts.set(userId, { bytes: 10, resetAt: Date.now() + 60_000 });
  store.accountQuotaRecords.set(`daily_team_creations:${userId}`, {
    key: `daily_team_creations:${userId}`,
    userId,
    quota: "daily_team_creations",
    used: 1,
    resetAt: Date.now() + 60_000
  });
  store.rateLimitStore.set("auth:session:session-leaving", {
    tokens: 0,
    updatedAt: Date.now(),
    lastSeenAt: Date.now()
  });
  store.deviceChallenges.set("challenge-leaving", { userId, deviceId: "device-one", expiresAt: Date.now() + 60_000 });
  store.invites.set("invite-leaving", {
    id: "invite-leaving",
    teamId: "team-shared",
    roomId: "room-live",
    creatorUserId: userId,
    createdAt: "2026-07-01T00:00:00.000Z"
  });
  store.inviteRequests.set("request-leaving", {
    requestId: "request-leaving",
    inviteId: "invite-leaving",
    requesterUserId: otherUserId,
    requesterDeviceId: "device-two",
    keyPackageId: "kp-remaining",
    keyPackageHash: `sha256:${"2".repeat(64)}`,
    sealedRequest: "AA==",
    createdAt: "2026-07-01T00:00:00.000Z"
  });
  store.attachmentBlobs.set("blob-shared", {
    id: "blob-shared",
    teamId: "team-shared",
    roomId: "room-live",
    name: "shared.bin",
    type: "application/octet-stream",
    size: 4,
    uploadedByUserId: userId,
    epoch: 1,
    sealedBlob: "AA==",
    createdAt: "2026-07-01T00:00:00.000Z"
  });
  store.acceptedMessageReceipts.set("receipt", {
    roomKey: "team-shared:room-live",
    messageId: "message-one",
    messageType: "application",
    senderUserId: userId,
    senderDeviceId: "device-one",
    parentEpoch: 1,
    digest: "digest",
    acceptedAt: "2026-07-01T00:00:00.000Z"
  });
  store.mlsBacklog.set("team-shared:room-live", [
    {
      id: "message-one",
      teamId: "team-shared",
      roomId: "room-live",
      senderUserId: userId,
      senderDeviceId: "device-one",
      createdAt: "2026-07-01T00:00:00.000Z",
      messageType: "application",
      epochHint: 1,
      mlsMessage: "AA=="
    }
  ]);

  assert.deepEqual(findAccountDeletionBlockers(store, userId), { ownedTeams: [], hostedRooms: [] });
  const deleted = deleteAccountOwnedRelayData(store, userId);
  assert.deepEqual(deleted, {
    authSessions: 1,
    deviceSessions: 0,
    devices: 1,
    keyPackages: 1,
    teamMemberships: 1,
    inviteArtifacts: 2,
    dailyTeamCreationQuotaRecords: 1,
    dailyRoomCreationQuotaRecords: 1,
    attachmentUploadQuotaRecords: 1,
    durableQuotaRecords: 1,
    rateLimitRecords: 1,
    deviceChallenges: 1
  });
  assert.equal(store.teamMembers.get("team-shared")?.has(userId), false);
  assert.equal(store.teams.get("team-shared")?.members, 1);
  assert.equal(store.rooms.get("room-deleted")?.host, "Deleted user");
  assert.equal(store.rooms.get("room-deleted")?.hostUserId, undefined);
  assert.equal(store.authSessions.has("session-remaining"), true);
  assert.equal(store.devices.has(`${otherUserId}:device-two`), true);
  assert.equal(store.keyPackages.has("kp-remaining"), true);
  assert.equal(store.dailyTeamCreationCounts.size, 0);
  assert.equal(store.dailyRoomCreationCounts.size, 0);
  assert.equal(store.attachmentBlobUploadByteCounts.size, 0);
  assert.equal(store.accountQuotaRecords.size, 0);
  assert.equal(store.rateLimitStore.size, 0);
  assert.equal(store.deviceChallenges.size, 0);
  assert.equal(store.invites.has("invite-leaving"), false);
  assert.equal(store.inviteRequests.has("request-leaving"), false);
  assert.equal(store.attachmentBlobs.has("blob-shared"), true);
  assert.equal(store.acceptedMessageReceipts.has("receipt"), true);
  assert.equal(store.mlsBacklog.get("team-shared:room-live")?.length, 1);
});

test("account deletion rollback preserves the session and concurrent unrelated mutations before a retry", async () => {
  const store = createRelayStore();
  const userId = "github:retry";
  store.teams.set("team-retry", { id: "team-retry", name: "Retry", members: 2 });
  store.teamMembers.set(
    "team-retry",
    new Map([
      [userId, { teamId: "team-retry", userId, role: "member", joinedAt: "2026-07-01T00:00:00.000Z" }],
      [
        "github:owner",
        {
          teamId: "team-retry",
          userId: "github:owner",
          role: "owner",
          joinedAt: "2026-07-01T00:00:00.000Z"
        }
      ]
    ])
  );
  store.authSessions.set("session-retry", {
    sessionIdHash: "session-retry",
    user: { id: userId, login: "retry" },
    expiresAt: Date.now() + 60_000
  });
  store.devices.set(`${userId}:device-retry`, device(userId, "device-retry"));
  store.accountQuotaRecords.set(`daily_room_creations:${userId}`, {
    key: `daily_room_creations:${userId}`,
    userId,
    quota: "daily_room_creations",
    used: 3,
    resetAt: Date.now() + 60_000
  });

  let rejectSave: ((error: Error) => void) | undefined;
  const delayedFailure = new Promise<void>((_resolve, reject) => {
    rejectSave = reject;
  });
  const firstAttempt = deleteAccountOwnedRelayDataAtomically(store, userId, () => delayedFailure);
  store.authSessions.set("session-concurrent", {
    sessionIdHash: "session-concurrent",
    user: { id: "github:concurrent", login: "concurrent" },
    expiresAt: Date.now() + 60_000
  });
  store.teams.set("team-concurrent", { id: "team-concurrent", name: "Concurrent", members: 0 });
  rejectSave?.(new Error("injected persistence failure"));

  await assert.rejects(firstAttempt, /injected persistence failure/);
  assert.equal(store.authSessions.has("session-retry"), true);
  assert.equal(store.teamMembers.get("team-retry")?.has(userId), true);
  assert.equal(store.teams.get("team-retry")?.members, 2);
  assert.equal(store.devices.has(`${userId}:device-retry`), true);
  assert.equal(store.accountQuotaRecords.get(`daily_room_creations:${userId}`)?.used, 3);
  assert.equal(store.authSessions.has("session-concurrent"), true);
  assert.equal(store.teams.has("team-concurrent"), true);

  const result = await deleteAccountOwnedRelayDataAtomically(store, userId, async () => undefined);
  assert.equal(result.authSessions, 1);
  assert.equal(result.teamMemberships, 1);
  assert.equal(result.devices, 1);
  assert.equal(result.durableQuotaRecords, 1);
  assert.equal(store.authSessions.has("session-retry"), false);
  assert.equal(store.teamMembers.get("team-retry")?.has(userId), false);
  assert.equal(store.accountQuotaRecords.has(`daily_room_creations:${userId}`), false);
  assert.equal(store.authSessions.has("session-concurrent"), true);
  assert.equal(store.teams.has("team-concurrent"), true);
});

test("restoring a pre-deletion SQLite backup cannot restore the deleted identity's session", async () => {
  const userId = "github:tester";
  const first = await startRelay();
  const backupPath = join(first.tempDir, "pre-deletion.sqlite");
  let restored: Awaited<ReturnType<typeof startRelay>> | undefined;
  try {
    const cookie = await createDebugSession(first.baseUrl, userId, "tester");
    await waitForStoredState(
      first.dataPath,
      (state) => Array.isArray(state.authSessions) && state.authSessions.length > 0
    );
    const source = new Database(first.dataPath, { readonly: true });
    await source.backup(backupPath);
    source.close();

    const deleted = await fetch(`${first.baseUrl}/auth/account`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmation: "delete my account" })
    });
    assert.equal(deleted.status, 200);
    await first.close({ preserveData: true });

    await copyFile(backupPath, first.dataPath);
    await Promise.all([rm(`${first.dataPath}-wal`, { force: true }), rm(`${first.dataPath}-shm`, { force: true })]);
    restored = await startRelay({}, undefined, first.dataPath);

    const rejected = await fetch(`${restored.baseUrl}/auth/me`, { headers: { cookie } });
    assert.equal(rejected.status, 401);
    assert.equal(((await rejected.json()) as { code?: string }).code, "authentication_required");
  } finally {
    await restored?.close();
    if (!restored) await first.close().catch(() => undefined);
  }
});

function room(id: string, hostUserId: string) {
  return {
    id,
    teamId: "team-shared",
    name: id,
    projectPath: "/tmp/shared",
    host: hostUserId,
    hostUserId,
    activeHostDeviceId: "device-one",
    hostStatus: "active" as const,
    approvalPolicy: "ask_every_turn" as const,
    codexModel: "gpt-5.4",
    browserProfilePersistent: false
  };
}

function device(userId: string, deviceId: string) {
  return {
    userId,
    deviceId,
    displayName: userId,
    signaturePublicKey: "AA==",
    signatureKeyFingerprint: `sha256:${"0".repeat(64)}` as const,
    hpkePublicKey: "AA==",
    hpkeKeyFingerprint: `sha256:${"1".repeat(64)}` as const,
    registeredAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-07-01T00:00:00.000Z"
  };
}

function keyPackage(id: string, userId: string, deviceId: string) {
  return {
    id,
    userId,
    deviceId,
    keyPackage: "AA==",
    keyPackageHash: `sha256:${"2".repeat(64)}` as const,
    ciphersuite: 2 as const,
    credentialIdentity: userId,
    createdAt: "2026-07-01T00:00:00.000Z"
  };
}
