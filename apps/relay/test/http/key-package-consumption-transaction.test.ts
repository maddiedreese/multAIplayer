import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InviteJoinRequestRecord, InviteRecord, KeyPackageRecord, RoomRecord } from "@multaiplayer/protocol";
import { consumeKeyPackageForInvite } from "../../src/http/key-package-consumption-transaction.js";
import { commitValidatedKeyPackages } from "../../src/http/key-package-upload-transaction.js";
import { createRelayStore } from "../../src/state.js";
import { createRelayPersistence } from "../../src/persistence.js";
import { acquireAccountMutationTurn } from "../../src/auth/account-mutation-transaction.js";

test("a concurrent consume waits for failed persistence rollback before reporting success", async () => {
  const store = createRelayStore();
  const room: RoomRecord = {
    id: "room-one",
    teamId: "team-one",
    name: "Room",
    host: "Host",
    hostUserId: "github:host",
    activeHostDeviceId: "host-device",
    hostStatus: "active",
    approvalPolicy: "ask_every_turn"
  };
  const keyPackage = keyPackageRecord();
  const invite: InviteRecord = {
    id: "invite-one",
    teamId: room.teamId,
    roomId: room.id,
    createdAt: "2026-07-16T12:00:00.000Z"
  };
  const request: InviteJoinRequestRecord = {
    requestId: "request-one",
    inviteId: invite.id,
    requesterUserId: keyPackage.userId,
    requesterDeviceId: keyPackage.deviceId,
    keyPackageId: keyPackage.id,
    keyPackageHash: keyPackage.keyPackageHash,
    sealedRequest: "AA==",
    createdAt: invite.createdAt
  };
  store.setTeam({ id: room.teamId, name: "Team", members: 1 });
  store.setRoom(room);
  store.setInvite(invite);
  store.setDevice({
    userId: keyPackage.userId,
    deviceId: keyPackage.deviceId,
    displayName: "Joiner",
    signaturePublicKey: "AA==",
    signatureKeyFingerprint: `sha256:${"0".repeat(64)}`,
    hpkePublicKey: "AA==",
    hpkeKeyFingerprint: `sha256:${"1".repeat(64)}`,
    registeredAt: invite.createdAt,
    lastSeenAt: invite.createdAt
  });
  store.setKeyPackage(keyPackage);
  store.inviteRequests.set(request.requestId, request);

  const firstSave = deferred<void>();
  const common = {
    store,
    teamId: room.teamId,
    roomId: room.id,
    expectedHostUserId: room.hostUserId!,
    expectedHostDeviceId: room.activeHostDeviceId!,
    inviteId: invite.id,
    userId: keyPackage.userId,
    deviceId: keyPackage.deviceId,
    keyPackageId: keyPackage.id,
    keyPackageHash: keyPackage.keyPackageHash,
    authorizationRemainsValid: () => true
  };
  const persistStarted = deferred<void>();
  const first = consumeKeyPackageForInvite({
    ...common,
    persist: async () => {
      persistStarted.resolve();
      await firstSave.promise;
    }
  });
  await persistStarted.promise;

  let secondSettled = false;
  const second = consumeKeyPackageForInvite({ ...common, persist: async () => undefined }).finally(() => {
    secondSettled = true;
  });
  await Promise.resolve();
  assert.equal(secondSettled, false, "retry must not observe the first consume's optimistic state");

  firstSave.reject(new Error("deterministic persistence failure"));
  assert.deepEqual(await first, { status: "persistence_unavailable" });
  assert.deepEqual(await second, { status: "accepted", keyPackage });
  assert.equal(store.keyPackages.has(keyPackage.id), false);
  assert.equal(store.consumedKeyPackages.has(keyPackage.keyPackageHash), true);
  assert.deepEqual(store.getInvite(invite.id), {
    ...invite,
    approvedUserId: keyPackage.userId,
    approvedDeviceId: keyPackage.deviceId,
    keyPackageHash: keyPackage.keyPackageHash
  });
});

test("a queued consume revalidates live host authority before mutation or persistence", async () => {
  const store = createRelayStore();
  const room: RoomRecord = {
    id: "room-one",
    teamId: "team-one",
    name: "Room",
    host: "Host",
    hostUserId: "github:host",
    activeHostDeviceId: "host-device",
    hostStatus: "active",
    approvalPolicy: "ask_every_turn"
  };
  const keyPackage = keyPackageRecord();
  const invite: InviteRecord = {
    id: "invite-one",
    teamId: room.teamId,
    roomId: room.id,
    createdAt: "2026-07-16T12:00:00.000Z"
  };
  const request: InviteJoinRequestRecord = {
    requestId: "request-one",
    inviteId: invite.id,
    requesterUserId: keyPackage.userId,
    requesterDeviceId: keyPackage.deviceId,
    keyPackageId: keyPackage.id,
    keyPackageHash: keyPackage.keyPackageHash,
    sealedRequest: "AA==",
    createdAt: invite.createdAt
  };
  store.setTeam({ id: room.teamId, name: "Team", members: 1 });
  store.setRoom(room);
  store.setInvite(invite);
  store.setDevice({
    userId: keyPackage.userId,
    deviceId: keyPackage.deviceId,
    displayName: "Joiner",
    signaturePublicKey: "AA==",
    signatureKeyFingerprint: `sha256:${"0".repeat(64)}`,
    hpkePublicKey: "AA==",
    hpkeKeyFingerprint: `sha256:${"1".repeat(64)}`,
    registeredAt: invite.createdAt,
    lastSeenAt: invite.createdAt
  });
  store.setKeyPackage(keyPackage);
  store.inviteRequests.set(request.requestId, request);

  const firstSave = deferred<void>();
  const common = {
    store,
    teamId: room.teamId,
    roomId: room.id,
    expectedHostUserId: room.hostUserId!,
    expectedHostDeviceId: room.activeHostDeviceId!,
    inviteId: invite.id,
    userId: keyPackage.userId,
    deviceId: keyPackage.deviceId,
    keyPackageId: keyPackage.id,
    keyPackageHash: keyPackage.keyPackageHash,
    authorizationRemainsValid: () => true
  };
  const persistStarted = deferred<void>();
  const first = consumeKeyPackageForInvite({
    ...common,
    persist: async () => {
      persistStarted.resolve();
      await firstSave.promise;
    }
  });
  await persistStarted.promise;

  let queuedPersistCalls = 0;
  const queued = consumeKeyPackageForInvite({
    ...common,
    persist: async () => {
      queuedPersistCalls += 1;
    }
  });
  await Promise.resolve();
  store.setRoom({
    ...room,
    host: "Replacement",
    hostUserId: "github:replacement",
    activeHostDeviceId: "replacement-device"
  });

  firstSave.reject(new Error("deterministic persistence failure"));
  assert.deepEqual(await first, { status: "persistence_unavailable" });
  assert.deepEqual(await queued, { status: "authorization_changed" });
  assert.equal(queuedPersistCalls, 0);
  assert.equal(store.keyPackages.get(keyPackage.id), keyPackage);
  assert.equal(store.consumedKeyPackages.size, 0);
  assert.deepEqual(store.getInvite(invite.id), invite);
});

test("an upload waits for consumption and cannot reintroduce the consumed KeyPackage under another id", async () => {
  const { store, room, invite, keyPackage, common } = transactionFixture();
  const save = deferred<void>();
  const persistStarted = deferred<void>();
  const consuming = consumeKeyPackageForInvite({
    ...common,
    persist: async () => {
      persistStarted.resolve();
      await save.promise;
    }
  });
  await persistStarted.promise;

  const alternateId = { ...keyPackage, id: "alternate-id" };
  let uploadSettled = false;
  const uploading = commitValidatedKeyPackages({
    store,
    userId: keyPackage.userId,
    deviceId: keyPackage.deviceId,
    accepted: [alternateId],
    accountLimit: 100,
    deviceLimit: 50,
    authorizationRemainsValid: () => true,
    persist: async () => undefined
  }).finally(() => {
    uploadSettled = true;
  });
  await Promise.resolve();
  assert.equal(uploadSettled, false);

  save.resolve();
  assert.deepEqual(await consuming, { status: "accepted", keyPackage });
  assert.deepEqual(await uploading, { status: "already_consumed" });
  assert.equal(store.keyPackages.has(alternateId.id), false);
  assert.equal(store.consumedKeyPackages.has(keyPackage.keyPackageHash), true);
  assert.equal(store.getInvite(invite.id)?.roomId, room.id);
});

test("failed consumption removes its tombstone before a queued upload evaluates live state", async () => {
  const { store, keyPackage, common } = transactionFixture();
  const save = deferred<void>();
  const consuming = consumeKeyPackageForInvite({ ...common, persist: () => save.promise });
  await Promise.resolve();
  const uploading = commitValidatedKeyPackages({
    store,
    userId: keyPackage.userId,
    deviceId: keyPackage.deviceId,
    accepted: [{ ...keyPackage, id: "alternate-id" }],
    accountLimit: 100,
    deviceLimit: 50,
    authorizationRemainsValid: () => true,
    persist: async () => undefined
  });
  save.reject(new Error("deterministic persistence failure"));
  assert.deepEqual(await consuming, { status: "persistence_unavailable" });
  assert.deepEqual(await uploading, { status: "conflict" });
  assert.equal(store.consumedKeyPackages.size, 0);
  assert.equal(store.keyPackages.get(keyPackage.id), keyPackage);
});

test("final consumption rejects an expired invite without mutation or persistence", async () => {
  const { store, invite, keyPackage, common } = transactionFixture({
    expiresAt: "2020-01-01T00:00:00.000Z"
  });
  let persistCalls = 0;
  assert.deepEqual(
    await consumeKeyPackageForInvite({
      ...common,
      persist: async () => {
        persistCalls += 1;
      }
    }),
    { status: "invite_expired" }
  );
  assert.equal(persistCalls, 0);
  assert.equal(store.keyPackages.get(keyPackage.id), keyPackage);
  assert.equal(store.consumedKeyPackages.size, 0);
  assert.deepEqual(store.getInvite(invite.id), invite);
});

test("queued consumption rechecks the host session authorization before mutation", async () => {
  const { store, keyPackage, common } = transactionFixture();
  const releaseHost = await acquireAccountMutationTurn(store, common.expectedHostUserId);
  let authorized = true;
  let persistCalls = 0;
  const consuming = consumeKeyPackageForInvite({
    ...common,
    authorizationRemainsValid: () => authorized,
    persist: async () => {
      persistCalls += 1;
    }
  });
  await Promise.resolve();
  authorized = false;
  releaseHost();
  assert.deepEqual(await consuming, { status: "authorization_changed" });
  assert.equal(persistCalls, 0);
  assert.equal(store.keyPackages.get(keyPackage.id), keyPackage);
});

test("a consumed hash survives restart and rejects alternate-id reuse", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-key-package-consume-"));
  const dataPath = join(directory, "relay.sqlite");
  let persistence = createRelayPersistence({ dataPath });
  try {
    const { store, keyPackage, common } = transactionFixture();
    const persistSnapshot = () =>
      persistence.save({
        version: 1,
        savedAt: new Date().toISOString(),
        teams: Array.from(store.teams.values()),
        rooms: Array.from(store.rooms.values()),
        invites: Array.from(store.invites.values()),
        devices: [],
        keyPackages: Array.from(store.keyPackages.values()),
        consumedKeyPackages: Array.from(store.consumedKeyPackages.values()),
        inviteRequests: Array.from(store.inviteRequests.values()),
        inviteResponses: [],
        inviteAckReceipts: [],
        acceptedMessageReceipts: [],
        teamMembers: [],
        authSessions: [],
        accountRestrictions: [],
        accountQuotaRecords: [],
        attachmentBlobs: [],
        appliedDeletionLedgerEntries: [],
        mlsBacklog: []
      });
    assert.deepEqual(await consumeKeyPackageForInvite({ ...common, persist: persistSnapshot }), {
      status: "accepted",
      keyPackage
    });
    persistence.close();
    persistence = createRelayPersistence({ dataPath });
    const restartedState = (await persistence.load()) as {
      consumedKeyPackages: Array<{
        keyPackageHash: string;
        userId: string;
        deviceId: string;
        consumedAt: string;
      }>;
    };
    assert.equal(restartedState.consumedKeyPackages[0]?.keyPackageHash, keyPackage.keyPackageHash);
    const restarted = createRelayStore();
    for (const consumed of restartedState.consumedKeyPackages) {
      restarted.consumedKeyPackages.set(consumed.keyPackageHash, consumed);
    }
    assert.deepEqual(
      await commitValidatedKeyPackages({
        store: restarted,
        userId: keyPackage.userId,
        deviceId: keyPackage.deviceId,
        accepted: [{ ...keyPackage, id: "alternate-id" }],
        accountLimit: 100,
        deviceLimit: 50,
        authorizationRemainsValid: () => true,
        persist: async () => assert.fail("restart must retain the consumed-hash rejection")
      }),
      { status: "already_consumed" }
    );
  } finally {
    persistence.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function transactionFixture(inviteOverrides: Partial<InviteRecord> = {}) {
  const store = createRelayStore();
  const room: RoomRecord = {
    id: "room-one",
    teamId: "team-one",
    name: "Room",
    host: "Host",
    hostUserId: "github:host",
    activeHostDeviceId: "host-device",
    hostStatus: "active",
    approvalPolicy: "ask_every_turn"
  };
  const keyPackage = keyPackageRecord();
  const invite: InviteRecord = {
    id: "invite-one",
    teamId: room.teamId,
    roomId: room.id,
    createdAt: "2026-07-16T12:00:00.000Z",
    ...inviteOverrides
  };
  const request: InviteJoinRequestRecord = {
    requestId: "request-one",
    inviteId: invite.id,
    requesterUserId: keyPackage.userId,
    requesterDeviceId: keyPackage.deviceId,
    keyPackageId: keyPackage.id,
    keyPackageHash: keyPackage.keyPackageHash,
    sealedRequest: "AA==",
    createdAt: invite.createdAt
  };
  store.setTeam({ id: room.teamId, name: "Team", members: 1 });
  store.setRoom(room);
  store.setInvite(invite);
  store.setDevice({
    userId: "github:joiner",
    deviceId: "joiner-device",
    displayName: "Joiner",
    signaturePublicKey: "AA==",
    signatureKeyFingerprint: `sha256:${"0".repeat(64)}`,
    hpkePublicKey: "AA==",
    hpkeKeyFingerprint: `sha256:${"1".repeat(64)}`,
    registeredAt: invite.createdAt,
    lastSeenAt: invite.createdAt
  });
  store.setKeyPackage(keyPackage);
  store.inviteRequests.set(request.requestId, request);
  return {
    store,
    room,
    invite,
    keyPackage,
    common: {
      store,
      teamId: room.teamId,
      roomId: room.id,
      expectedHostUserId: room.hostUserId!,
      expectedHostDeviceId: room.activeHostDeviceId!,
      inviteId: invite.id,
      userId: keyPackage.userId,
      deviceId: keyPackage.deviceId,
      keyPackageId: keyPackage.id,
      keyPackageHash: keyPackage.keyPackageHash,
      authorizationRemainsValid: () => true
    }
  };
}

function keyPackageRecord(): KeyPackageRecord {
  const encoded = "AA==";
  return {
    id: "key-package-one",
    keyPackage: encoded,
    keyPackageHash: `sha256:${createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex")}`,
    ciphersuite: 2,
    userId: "github:joiner",
    deviceId: "joiner-device",
    credentialIdentity: "fixture",
    createdAt: "2026-07-16T12:00:00.000Z"
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
