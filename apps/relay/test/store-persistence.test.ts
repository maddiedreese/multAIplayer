import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelayStaleEpochError } from "../src/persistence.js";
import { SqliteRelayPersistence } from "../src/sqlite-persistence.js";
import { createRelayStorePersistenceCoordinator, RelayPersistenceLoadError } from "../src/store-persistence.js";

test("relay persistence flushes durable mutations and closes", async () => {
  let saves = 0,
    closed = false;
  const persistence = {
    load: async () => null,
    save: async () => assert.fail("whole-state save is reserved for initial state"),
    saveChanges: () => {
      saves++;
      return true;
    },
    saveKeyPackages: () => {},
    saveMlsBacklog: () => true,
    saveMlsMessage: () => true,
    saveMlsCommit: () => {},
    close: () => {
      closed = true;
    }
  };
  const codec = {
    isExpiredInvite: () => false,
    isExpiredAttachmentBlob: () => false,
    applyStoredRelayState: () => {},
    pruneExpiredRelayState: () => {},
    drainStoredRelayMutations: () => [{ entity: "rooms" as const, key: "room", operation: "delete" as const }],
    discardStoredRelayMutations: () => {},
    toStoredRelayState: () =>
      ({
        version: 1,
        savedAt: new Date().toISOString(),
        teams: [],
        rooms: [],
        invites: [],
        encryptedBacklog: []
      }) as never
  };
  const coordinator = createRelayStorePersistenceCoordinator({ dataPath: "unused", persistence, storeCodec: codec });
  coordinator.scheduleStoreSave();
  await coordinator.closeRelayStore();
  assert.ok(saves >= 1);
  assert.equal(closed, true);
});

test("row persistence never serializes the whole relay store", async () => {
  let mutationDrains = 0;
  let globalPrunes = 0;
  const persisted: unknown[] = [];
  const persistence = {
    load: async () => null,
    save: async () => assert.fail("whole-state save must not run for immediate persistence"),
    saveChanges: (changes: unknown[]) => {
      persisted.push(...changes);
      return true;
    },
    saveKeyPackages: () => {},
    saveMlsBacklog: () => true,
    saveMlsMessage: () => true,
    saveMlsCommit: () => {},
    close: () => {}
  };
  const codec = {
    isExpiredInvite: () => false,
    isExpiredAttachmentBlob: () => false,
    applyStoredRelayState: () => {},
    pruneExpiredRelayState: () => {
      globalPrunes++;
    },
    drainStoredRelayMutations: () =>
      mutationDrains++ === 0
        ? [{ entity: "rooms" as const, key: "room", operation: "upsert" as const, value: { id: "room" } }]
        : [],
    discardStoredRelayMutations: () => {},
    toStoredRelayState: () => assert.fail("immediate persistence must not encode the world")
  };
  const coordinator = createRelayStorePersistenceCoordinator({ dataPath: "unused", persistence, storeCodec: codec });
  coordinator.scheduleStoreSave();
  assert.equal(globalPrunes, 0);
  assert.equal(persisted.length, 1);
  await coordinator.saveKeyPackages();
  await coordinator.saveMlsMessage(
    "team:room",
    {
      id: "message",
      teamId: "team",
      roomId: "room",
      senderUserId: "user",
      senderDeviceId: "device",
      createdAt: new Date().toISOString(),
      messageType: "application",
      epochHint: 0,
      mlsMessage: "AA=="
    },
    []
  );
  await coordinator.saveRelayStore();
  assert.equal(globalPrunes, 0);
  await coordinator.closeRelayStore();
  assert.equal(globalPrunes, 1);
});

test("scheduled mutation failures poison persistence until restart and still close the database", async () => {
  let poisoned = 0;
  let closed = false;
  const persistence = {
    load: async () => null,
    save: async () => {},
    saveChanges: () => {
      throw new Error("disk full");
    },
    saveKeyPackages: () => {},
    saveMlsBacklog: () => true,
    saveMlsMessage: () => true,
    saveMlsCommit: () => {},
    close: () => {
      closed = true;
    }
  };
  const codec = {
    isExpiredInvite: () => false,
    isExpiredAttachmentBlob: () => false,
    applyStoredRelayState: () => {},
    pruneExpiredRelayState: () => {},
    drainStoredRelayMutations: () => [{ entity: "rooms" as const, key: "room", operation: "delete" as const }],
    discardStoredRelayMutations: () => {},
    toStoredRelayState: () => ({ version: 1 }) as never
  };
  const coordinator = createRelayStorePersistenceCoordinator({
    dataPath: "unused",
    persistence,
    storeCodec: codec,
    onPoison: () => poisoned++
  });
  assert.throws(() => coordinator.scheduleStoreSave(), /restart the relay/);
  assert.equal(coordinator.isHealthy(), false);
  assert.equal(poisoned, 1);
  assert.throws(() => coordinator.scheduleStoreSave(), /restart the relay/);
  assert.equal(poisoned, 1);
  await coordinator.closeRelayStore();
  assert.equal(closed, true);
});

test("an expected competing MLS commit does not poison persistence", async () => {
  const retriedChanges: unknown[][] = [];
  let mutationDrains = 0;
  const persistence = {
    load: async () => null,
    save: async () => {},
    saveChanges: (changes: unknown[]) => {
      retriedChanges.push(changes);
      return true;
    },
    saveKeyPackages: () => {},
    saveMlsBacklog: () => true,
    saveMlsMessage: () => true,
    saveMlsCommit: () => {
      throw new RelayStaleEpochError();
    },
    close: () => {}
  };
  const codec = {
    isExpiredInvite: () => false,
    isExpiredAttachmentBlob: () => false,
    applyStoredRelayState: () => {},
    pruneExpiredRelayState: () => {},
    drainStoredRelayMutations: () =>
      mutationDrains++ === 0 ? [{ entity: "rooms" as const, key: "room", operation: "delete" as const }] : [],
    discardStoredRelayMutations: () => {},
    toStoredRelayState: () => ({ version: 1 }) as never
  };
  const coordinator = createRelayStorePersistenceCoordinator({ dataPath: "unused", persistence, storeCodec: codec });
  await assert.rejects(
    async () =>
      coordinator.saveMlsCommit(
        "team:room",
        {
          id: "commit",
          teamId: "team",
          roomId: "room",
          senderUserId: "user",
          senderDeviceId: "device",
          createdAt: new Date().toISOString(),
          messageType: "commit",
          epochHint: 0,
          mlsMessage: "AA=="
        },
        []
      ),
    RelayStaleEpochError
  );
  assert.equal(coordinator.isHealthy(), true);
  coordinator.scheduleStoreSave();
  assert.deepEqual(retriedChanges, [[{ entity: "rooms", key: "room", operation: "delete" }]]);
});

test("unsupported stored versions remain fail-closed across supervised restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-persistent-load-failure-"));
  const dataPath = join(directory, "relay.sqlite");
  const initial = new SqliteRelayPersistence(dataPath);
  try {
    await initial.save({ version: 2, savedAt: new Date().toISOString(), teams: [], rooms: [], mlsBacklog: [] });
    initial.close();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const persistence = new SqliteRelayPersistence(dataPath);
      const coordinator = createRelayStorePersistenceCoordinator({
        dataPath,
        persistence,
        storeCodec: inertCodec()
      });
      await assert.rejects(coordinator.loadRelayStore(), RelayPersistenceLoadError);
      persistence.close();
    }
  } finally {
    initial.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("unreadable stored state fails startup without mutating its recovery source", async () => {
  let loadCalls = 0;
  const coordinator = createRelayStorePersistenceCoordinator({
    dataPath: "unused",
    persistence: {
      load: async () => {
        loadCalls += 1;
        throw new Error("corrupt database");
      },
      save: async () => {},
      saveChanges: () => true,
      saveKeyPackages: () => {},
      saveMlsBacklog: () => true,
      saveMlsMessage: () => true,
      saveMlsCommit: () => {},
      close: () => {}
    },
    storeCodec: inertCodec()
  });
  await assert.rejects(coordinator.loadRelayStore(), RelayPersistenceLoadError);
  assert.equal(loadCalls, 1);
});

test("capacity reclamation persists prune mutations before admitting new payloads", async () => {
  let pruned = 0;
  const saved: unknown[] = [];
  const coordinator = createRelayStorePersistenceCoordinator({
    dataPath: "unused",
    persistence: {
      load: async () => null,
      save: async () => {},
      saveChanges: (changes) => {
        saved.push(...changes);
        return true;
      },
      saveKeyPackages: () => {},
      saveMlsBacklog: () => true,
      saveMlsMessage: () => true,
      saveMlsCommit: () => {},
      close: () => {}
    },
    storeCodec: {
      ...inertCodec(),
      pruneExpiredRelayState: () => void (pruned += 1),
      drainStoredRelayMutations: () => [
        { entity: "attachmentBlobs", key: "expired", operation: "delete" as const },
        { entity: "mlsBacklog", key: "team:archived", operation: "delete" as const }
      ]
    }
  });
  await coordinator.reclaimDurableCapacity();
  assert.equal(pruned, 1);
  assert.deepEqual(saved, [
    { entity: "attachmentBlobs", key: "expired", operation: "delete" },
    { entity: "mlsBacklog", key: "team:archived", operation: "delete" }
  ]);
});

function inertCodec() {
  return {
    isExpiredInvite: () => false,
    isExpiredAttachmentBlob: () => false,
    applyStoredRelayState: () => {},
    pruneExpiredRelayState: () => {},
    drainStoredRelayMutations: () => [],
    discardStoredRelayMutations: () => {},
    toStoredRelayState: () => ({ version: 1 }) as never
  };
}
