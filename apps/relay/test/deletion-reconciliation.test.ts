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
    accessToken: "secret",
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
  await assert.rejects(
    () => reconcileDeletionLedger({ ledger: ledgerFor(userId), store, persist: async () => undefined }),
    DeletionReconciliationBlockedError
  );
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
      accessToken: "secret",
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
