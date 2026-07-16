import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRelayStore } from "../src/state.js";
import {
  deletionSubject,
  FileDeletionLedger,
  type DeletionLedger,
  type DeletionLedgerEntry
} from "../src/auth/deletion-ledger.js";
import { DeletionReconciliationBlockedError, reconcileDeletionLedger } from "../src/auth/deletion-reconciliation.js";

const key = "test-deletion-ledger-hmac-key-with-more-than-32-characters";

function ledgerFor(userId: string): DeletionLedger {
  const subject = deletionSubject(key, userId);
  const entry: DeletionLedgerEntry = {
    version: 1,
    id: subject,
    subject,
    requestedAt: "2026-07-14T00:00:00.000Z",
    protectUntil: "2026-10-12T00:00:00.000Z",
    mac: "0".repeat(64)
  };
  return {
    record: async () => entry,
    list: async () => [entry],
    purgeExpired: async () => 0,
    subjectFor: (candidate) => deletionSubject(key, candidate),
    isProtected: (candidate) => candidate === userId
  };
}

test("reconciliation deletes resurrected identity data even when an applied marker survived", async () => {
  const store = createRelayStore();
  const userId = "github:restored";
  const ledger = ledgerFor(userId);
  const [entry] = await ledger.list();
  store.authSessions.set("restored-session", {
    sessionIdHash: "restored-session",
    user: { id: userId, login: "restored" },
    expiresAt: Date.now() + 60_000
  });
  store.devices.set(`${userId}:device`, {
    userId,
    deviceId: "device",
    publicKeyFingerprint: "fingerprint",
    publicKeyJwk: "{}",
    registeredAt: "2026-07-01T00:00:00.000Z"
  });
  store.appliedDeletionLedgerEntries.set(entry!.id, {
    entryId: entry!.id,
    appliedAt: "2026-07-14T00:00:01.000Z"
  });
  let persisted = 0;
  const result = await reconcileDeletionLedger({ ledger, store, persist: async () => void (persisted += 1) });
  assert.equal(result.identitiesDeleted, 1);
  assert.equal(store.authSessions.size, 0);
  assert.equal(store.devices.size, 0);
  assert.equal(persisted, 1);
});

test("reconciliation fails closed when an older restore resurrects active ownership", async () => {
  const store = createRelayStore();
  const userId = "github:owner";
  store.teams.set("team", { id: "team", name: "Team", members: 1, createdAt: "2026-01-01T00:00:00.000Z" });
  store.teamMembers.set("team", new Map([[userId, { userId, role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }]]));
  const subject = ledgerFor(userId).subjectFor(userId);
  await assert.rejects(
    () => reconcileDeletionLedger({ ledger: ledgerFor(userId), store, persist: async () => undefined }),
    (error: unknown) => {
      assert.ok(error instanceof DeletionReconciliationBlockedError);
      assert.equal(error.subject, subject);
      assert.match(error.message, new RegExp(subject));
      return true;
    }
  );
});

test("reconciliation discovers an identity represented only by a durable quota row", async () => {
  const store = createRelayStore();
  const userId = "github:quota-only-restore";
  store.accountQuotaRecords.set(`daily_team_creations:${userId}`, {
    key: `daily_team_creations:${userId}`,
    userId,
    quota: "daily_team_creations",
    used: 1,
    resetAt: Date.now() + 60_000
  });

  const result = await reconcileDeletionLedger({
    ledger: ledgerFor(userId),
    store,
    persist: async () => undefined
  });

  assert.equal(result.identitiesDeleted, 1);
  assert.equal(store.accountQuotaRecords.size, 0);
});

test("offline resolution deletes only resources owned by the exact reported subject", async () => {
  const store = createRelayStore();
  const userId = "github:owner";
  const ledger = ledgerFor(userId);
  store.teams.set("team", { id: "team", name: "Team", members: 1 });
  store.teamMembers.set(
    "team",
    new Map([[userId, { teamId: "team", userId, role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }]])
  );
  store.rooms.set("room", {
    id: "room",
    teamId: "team",
    name: "Room",
    host: "Owner",
    hostUserId: userId,
    activeHostDeviceId: "device",
    hostStatus: "active",
    acceptedMlsEpoch: 0,
    approvalPolicy: "ask_every_turn"
  });
  store.rooms.set("collaborator-room", {
    ...store.rooms.get("room")!,
    id: "collaborator-room",
    name: "Collaborator room",
    host: "Collaborator",
    hostUserId: "github:collaborator",
    activeHostDeviceId: "collaborator-device"
  });
  store.invites.set("team-invite", {
    id: "team-invite",
    teamId: "team",
    roomId: "collaborator-room",
    creatorUserId: "github:collaborator",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z"
  });
  const result = await reconcileDeletionLedger({
    ledger,
    store,
    deleteOwnedResourcesForSubject: ledger.subjectFor(userId),
    persist: async () => undefined
  });
  assert.equal(result.conflictsResolved, 1);
  assert.ok(store.teams.get("team")?.deletedAt);
  assert.ok(store.rooms.get("room")?.deletedAt);
  assert.ok(store.rooms.get("collaborator-room")?.deletedAt);
  assert.equal(store.invites.has("team-invite"), false);
  assert.equal(store.teamMembers.get("team")?.has(userId), false);
});

test("offline resolution revokes invite artifacts for a restored hosted room", async () => {
  const store = createRelayStore();
  const userId = "github:host";
  const ledger = ledgerFor(userId);
  store.teams.set("team", { id: "team", name: "Team", members: 2 });
  store.teamMembers.set(
    "team",
    new Map([
      ["github:owner", { teamId: "team", userId: "github:owner", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }],
      [userId, { teamId: "team", userId, role: "member", joinedAt: "2026-01-01T00:00:00.000Z" }]
    ])
  );
  store.rooms.set("room", {
    id: "room",
    teamId: "team",
    name: "Room",
    host: "Host",
    hostUserId: userId,
    hostStatus: "active",
    approvalPolicy: "ask_every_turn"
  });
  store.invites.set("invite", {
    id: "invite",
    teamId: "team",
    roomId: "room",
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  store.inviteResponses.set("request", {
    requestId: "request",
    inviteId: "invite",
    requesterUserId: "github:joiner",
    requesterDeviceId: "device",
    status: "approved",
    responseBinding: { teamId: "team", hostUserId: userId }
  } as never);

  const result = await reconcileDeletionLedger({
    ledger,
    store,
    deleteOwnedResourcesForSubject: ledger.subjectFor(userId),
    persist: async () => undefined
  });

  assert.equal(result.conflictsResolved, 1);
  assert.ok(store.rooms.get("room")?.deletedAt);
  assert.equal(store.invites.size, 0);
  assert.equal(store.inviteResponses.size, 0);
});

test("reconciliation removes only markers whose external protection has expired", async () => {
  const store = createRelayStore();
  const ledger = ledgerFor("github:active");
  const [active] = await ledger.list();
  store.appliedDeletionLedgerEntries.set(active!.id, {
    entryId: active!.id,
    appliedAt: "2026-07-14T00:00:01.000Z"
  });
  store.appliedDeletionLedgerEntries.set("f".repeat(64), {
    entryId: "f".repeat(64),
    appliedAt: "2026-01-01T00:00:00.000Z"
  });
  const result = await reconcileDeletionLedger({ ledger, store, persist: async () => undefined });
  assert.equal(result.markersPruned, 1);
  assert.equal(store.appliedDeletionLedgerEntries.has(active!.id), true);
  assert.equal(store.appliedDeletionLedgerEntries.has("f".repeat(64)), false);
});

test("delayed primary cleanup appends protection for 90 days from the cleanup attempt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deletion-reconciliation-"));
  let current = new Date("2026-07-01T00:00:00.000Z");
  const ledger = new FileDeletionLedger(directory, key, 7_776_000, () => current);
  const userId = "github:delayed";
  try {
    const requested = await ledger.record(userId);
    const store = createRelayStore();
    store.authSessions.set("delayed-session", {
      sessionIdHash: "delayed-session",
      user: { id: userId, login: "delayed" },
      expiresAt: Date.now() + 60_000
    });
    current = new Date("2026-07-11T00:00:00.000Z");
    const result = await reconcileDeletionLedger({ ledger, store, persist: async () => undefined });
    const entries = await ledger.list();
    assert.equal(result.entries, 2);
    assert.equal(entries.length, 2);
    assert.equal(store.appliedDeletionLedgerEntries.size, 2);
    assert.equal(requested.protectUntil, "2026-09-29T00:00:00.000Z");
    assert.equal(entries.find((entry) => entry.id !== requested.id)?.protectUntil, "2026-10-09T00:00:00.000Z");
    current = new Date("2026-09-30T00:00:00.000Z");
    assert.equal(await ledger.purgeExpired(), 1);
    assert.equal(ledger.isProtected(userId), true);
    current = new Date("2026-10-09T00:00:00.000Z");
    assert.equal(await ledger.purgeExpired(), 1);
    assert.equal(ledger.isProtected(userId), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restart after the original horizon deletes the identity before purging and extends protection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deletion-reconciliation-expired-"));
  let current = new Date("2026-07-01T00:00:00.000Z");
  const ledger = new FileDeletionLedger(directory, key, 7_776_000, () => current);
  const userId = "github:expired-but-pending";
  try {
    const original = await ledger.record(userId);
    const store = createRelayStore();
    store.authSessions.set("pending-session", {
      sessionIdHash: "pending-session",
      user: { id: userId, login: "expired-but-pending" },
      expiresAt: Date.now() + 60_000
    });

    current = new Date("2026-10-01T00:00:00.000Z");
    let persistCalls = 0;
    const result = await reconcileDeletionLedger({
      ledger,
      store,
      now: () => current,
      persist: async () => {
        persistCalls += 1;
        if (persistCalls !== 1) return;
        assert.equal(store.authSessions.size, 0, "primary identity data is deleted before expiry collection");
        assert.equal((await ledger.list()).length, 2, "old and freshly extended entries still exist at commit time");
      }
    });

    const remaining = await ledger.list();
    assert.equal(result.identitiesDeleted, 1);
    assert.equal(result.markersPruned, 1);
    assert.equal(persistCalls, 2);
    assert.equal(remaining.length, 1);
    assert.notEqual(remaining[0]?.id, original.id);
    assert.equal(remaining[0]?.protectUntil, "2026-12-30T00:00:00.000Z");
    assert.equal(store.appliedDeletionLedgerEntries.has(original.id), false);
    assert.equal(store.appliedDeletionLedgerEntries.has(remaining[0]!.id), true);
    assert.equal(ledger.isProtected(userId), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
