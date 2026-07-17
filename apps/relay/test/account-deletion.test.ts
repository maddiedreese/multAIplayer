import test from "node:test";
import {
  deleteAccountOwnedRelayData,
  deleteAccountOwnedRelayDataAtomically,
  findAccountDeletionBlockers
} from "../src/auth/account-deletion.js";
import { createRelayStore } from "../src/state.js";
import { commitValidatedKeyPackages } from "../src/http/key-package-upload-transaction.js";
import { acquireAccountMutationTurn, acquireAccountMutationTurns } from "../src/auth/account-mutation-transaction.js";
import { assert, delay } from "./support/relay.js";

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
  store.consumedKeyPackages.set(`sha256:${"1".repeat(64)}`, {
    keyPackageHash: `sha256:${"1".repeat(64)}`,
    userId,
    deviceId: "device-one",
    consumedAt: "2026-07-01T00:00:00.000Z"
  });
  store.consumedKeyPackages.set(`sha256:${"2".repeat(64)}`, {
    keyPackageHash: `sha256:${"2".repeat(64)}`,
    userId: otherUserId,
    deviceId: "device-two",
    consumedAt: "2026-07-01T00:00:00.000Z"
  });
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
    consumedKeyPackagesDeattributed: 1,
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
  assert.equal(store.consumedKeyPackages.size, 2);
  assert.deepEqual(store.consumedKeyPackages.get(`sha256:${"1".repeat(64)}`), {
    keyPackageHash: `sha256:${"1".repeat(64)}`,
    consumedAt: "2026-07-01T00:00:00.000Z"
  });
  assert.equal(store.consumedKeyPackages.get(`sha256:${"2".repeat(64)}`)?.userId, otherUserId);
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
  const consumedHash = `sha256:${"3".repeat(64)}`;
  store.consumedKeyPackages.set(consumedHash, {
    keyPackageHash: consumedHash,
    userId,
    deviceId: "device-retry",
    consumedAt: "2026-07-01T00:00:00.000Z"
  });
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
  assert.equal(store.consumedKeyPackages.has(consumedHash), true);
  assert.equal(store.accountQuotaRecords.get(`daily_room_creations:${userId}`)?.used, 3);
  assert.equal(store.authSessions.has("session-concurrent"), true);
  assert.equal(store.teams.has("team-concurrent"), true);

  const result = await deleteAccountOwnedRelayDataAtomically(store, userId, async () => undefined);
  assert.equal(result.authSessions, 1);
  assert.equal(result.teamMemberships, 1);
  assert.equal(result.devices, 1);
  assert.equal(result.consumedKeyPackagesDeattributed, 1);
  assert.equal(result.durableQuotaRecords, 1);
  assert.equal(store.authSessions.has("session-retry"), false);
  assert.equal(store.teamMembers.get("team-retry")?.has(userId), false);
  assert.equal(store.accountQuotaRecords.has(`daily_room_creations:${userId}`), false);
  assert.deepEqual(store.consumedKeyPackages.get(consumedHash), {
    keyPackageHash: consumedHash,
    consumedAt: "2026-07-01T00:00:00.000Z"
  });
  store.setDevice(device(userId, "device-retry"));
  assert.deepEqual(
    await commitValidatedKeyPackages({
      store,
      userId,
      deviceId: "device-retry",
      accepted: [{ ...keyPackage("kp-replayed", userId, "device-retry"), keyPackageHash: consumedHash }],
      accountLimit: 50,
      deviceLimit: 50,
      authorizationRemainsValid: () => true,
      persist: async () => assert.fail("a deattributed consumed hash must reject before persistence")
    }),
    { status: "already_consumed" }
  );
  assert.equal(store.authSessions.has("session-concurrent"), true);
  assert.equal(store.teams.has("team-concurrent"), true);
});

test("a KeyPackage validated before account deletion cannot commit after deletion succeeds", async () => {
  const store = createRelayStore();
  const userId = "github:deletion-race";
  const deviceId = "device-race";
  store.setDevice(device(userId, deviceId));
  const accepted = keyPackage("kp-race", userId, deviceId);
  const validation = deferred<void>();
  const uploading = validation.promise.then(() =>
    commitValidatedKeyPackages({
      store,
      userId,
      deviceId,
      accepted: [accepted],
      accountLimit: 100,
      deviceLimit: 50,
      authorizationRemainsValid: () => true,
      persist: async () => undefined
    })
  );

  const deleted = await deleteAccountOwnedRelayDataAtomically(store, userId, async () => undefined);
  assert.equal(deleted.devices, 1);
  validation.resolve();

  assert.deepEqual(await uploading, { status: "authorization_changed" });
  assert.equal(store.keyPackages.has(accepted.id), false);
  assert.equal(store.getDevice(userId, deviceId), undefined);
});

test("account deletion holds its identity turn until primary persistence completes", async () => {
  const store = createRelayStore();
  const userId = "github:deleting";
  const persistStarted = deferred<void>();
  const finishPersist = deferred<void>();
  const deleting = deleteAccountOwnedRelayDataAtomically(store, userId, async () => {
    persistStarted.resolve();
    await finishPersist.promise;
  });
  await persistStarted.promise;

  let queuedMutationSettled = false;
  const queuedMutation = acquireAccountMutationTurn(store, userId).then((release) => {
    queuedMutationSettled = true;
    release();
  });
  await delay(25);
  assert.equal(queuedMutationSettled, false);

  finishPersist.resolve();
  await deleting;
  await queuedMutation;
  assert.equal(queuedMutationSettled, true);
});

test("account deletion blocks ownership mutations that also lock another account", async () => {
  const store = createRelayStore();
  const deletingUserId = "github:deleting";
  const ownerUserId = "github:owner";
  const persistStarted = deferred<void>();
  const finishPersist = deferred<void>();
  const deleting = deleteAccountOwnedRelayDataAtomically(store, deletingUserId, async () => {
    persistStarted.resolve();
    await finishPersist.promise;
  });
  await persistStarted.promise;

  let ownershipMutationSettled = false;
  const ownershipMutation = acquireAccountMutationTurns(store, [ownerUserId, deletingUserId]).then((release) => {
    ownershipMutationSettled = true;
    release();
  });
  await delay(25);
  assert.equal(ownershipMutationSettled, false);

  finishPersist.resolve();
  await deleting;
  await ownershipMutation;
  assert.equal(ownershipMutationSettled, true);
});

test("multi-account mutation turns use one deterministic order", async () => {
  const store = createRelayStore();
  const completed: string[] = [];
  const run = async (name: string, userIds: string[]) => {
    const release = await acquireAccountMutationTurns(store, userIds);
    try {
      completed.push(name);
      await Promise.resolve();
    } finally {
      release();
    }
  };
  await Promise.race([
    Promise.all([run("forward", ["github:a", "github:b"]), run("reverse", ["github:b", "github:a"])]),
    delay(1_000).then(() => assert.fail("cross-ordered account turns deadlocked"))
  ]);
  assert.deepEqual(completed.sort(), ["forward", "reverse"]);
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
    codexModel: "gpt-5.4"
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
