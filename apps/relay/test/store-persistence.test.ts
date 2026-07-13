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
