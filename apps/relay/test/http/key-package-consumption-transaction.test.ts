import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { InviteJoinRequestRecord, InviteRecord, KeyPackageRecord, RoomRecord } from "@multaiplayer/protocol";
import { consumeKeyPackageForInvite } from "../../src/http/key-package-consumption-transaction.js";
import { createRelayStore } from "../../src/state.js";

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
    keyPackageHash: keyPackage.keyPackageHash
  };
  const first = consumeKeyPackageForInvite({ ...common, persist: () => firstSave.promise });
  await Promise.resolve();

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
    keyPackageHash: keyPackage.keyPackageHash
  };
  const first = consumeKeyPackageForInvite({ ...common, persist: () => firstSave.promise });
  await Promise.resolve();

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
  assert.deepEqual(store.getInvite(invite.id), invite);
});

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
