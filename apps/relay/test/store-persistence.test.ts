import assert from "node:assert/strict";
import test from "node:test";
import { createRelayStorePersistenceCoordinator } from "../src/store-persistence.js";

test("relay persistence flushes and closes", async () => {
  let saves = 0,
    closed = false;
  const persistence = {
    flushMode: "debounced" as const,
    load: async () => null,
    save: async () => {
      saves++;
    },
    saveChanges: async () => false,
    saveKeyPackages: async () => {},
    saveMlsBacklog: async () => true,
    saveMlsMessage: async () => true,
    saveMlsCommit: async () => {},
    quarantine: async () => {},
    close: () => {
      closed = true;
    }
  };
  const codec = {
    isExpiredInvite: () => false,
    isExpiredAttachmentBlob: () => false,
    applyStoredRelayState: () => {},
    pruneExpiredRelayState: () => {},
    drainStoredRelayMutations: () => [],
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

test("immediate row persistence never serializes the whole relay store", async () => {
  let mutationDrains = 0;
  let globalPrunes = 0;
  const persisted: unknown[] = [];
  const persistence = {
    flushMode: "immediate" as const,
    load: async () => null,
    save: async () => assert.fail("whole-state save must not run for immediate persistence"),
    saveChanges: async (changes: unknown[]) => {
      persisted.push(...changes);
      return true;
    },
    saveKeyPackages: async () => {},
    saveMlsBacklog: async () => true,
    saveMlsMessage: async () => true,
    saveMlsCommit: async () => {},
    quarantine: async () => {},
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

test("debounced whole-state saves never overlap and the queue continues after failure", async () => {
  let saveCalls = 0;
  let activeSaves = 0;
  let rejectFirst!: (error: Error) => void;
  const firstEntered = Promise.withResolvers<void>();
  const persistence = {
    flushMode: "debounced" as const,
    load: async () => null,
    async save() {
      saveCalls++;
      activeSaves++;
      assert.equal(activeSaves, 1);
      if (saveCalls === 1) {
        firstEntered.resolve();
        await new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }).finally(() => activeSaves--);
        return;
      }
      activeSaves--;
    },
    saveChanges: async () => false,
    saveKeyPackages: async () => {},
    saveMlsBacklog: async () => true,
    saveMlsMessage: async () => true,
    saveMlsCommit: async () => {},
    quarantine: async () => {},
    close: () => {}
  };
  const codec = {
    isExpiredInvite: () => false,
    isExpiredAttachmentBlob: () => false,
    applyStoredRelayState: () => {},
    pruneExpiredRelayState: () => {},
    drainStoredRelayMutations: () => [],
    discardStoredRelayMutations: () => {},
    toStoredRelayState: () => ({ version: 1 }) as never
  };
  const coordinator = createRelayStorePersistenceCoordinator({ dataPath: "unused", persistence, storeCodec: codec });
  const failed = coordinator.saveRelayStore();
  await firstEntered.promise;
  const queued = coordinator.saveRelayStore();
  await Promise.resolve();
  assert.equal(saveCalls, 1);
  rejectFirst(new Error("injected first save failure"));
  await assert.rejects(failed, /injected first save failure/);
  await queued;
  assert.equal(saveCalls, 2);
  assert.equal(activeSaves, 0);
});
