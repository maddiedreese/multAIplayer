import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { RelayEnvelope } from "@multaiplayer/protocol";
import type { RelayPersistence } from "../src/persistence.js";
import { createRelayStorePersistenceCoordinator } from "../src/store-persistence.js";
import type { RelayStoreCodec, StoredRelayState } from "../src/store-codec.js";
import type { RoomKey } from "../src/state.js";

function storedState(sequence: number): StoredRelayState {
  return {
    version: 1,
    savedAt: `2026-07-07T00:00:0${sequence}.000Z`,
    teams: [],
    rooms: [],
    invites: [],
    encryptedBacklog: []
  };
}

test("relay store persistence debounces repeated save requests", async () => {
  const savedStates: unknown[] = [];
  let sequence = 0;
  const persistence: RelayPersistence = {
    flushMode: "debounced",
    async load() {
      return null;
    },
    async save(state) {
      savedStates.push(state);
    },
    async saveEncryptedBacklog() {
      return false;
    },
    async saveEncryptedEnvelope() {
      return false;
    },
    async quarantine() {},
    close() {}
  };
  const storeCodec: RelayStoreCodec = {
    isExpiredInvite() {
      return false;
    },
    isExpiredAttachmentBlob() {
      return false;
    },
    applyStoredRelayState() {},
    pruneExpiredRelayState() {},
    toStoredRelayState() {
      sequence += 1;
      return storedState(sequence);
    }
  };
  const coordinator = createRelayStorePersistenceCoordinator({
    dataPath: "memory",
    persistence,
    storeCodec
  });

  coordinator.scheduleStoreSave();
  coordinator.scheduleStoreSave();
  coordinator.scheduleStoreSave();

  assert.equal(savedStates.length, 0);
  await delay(150);
  assert.equal(savedStates.length, 1);
  assert.equal((savedStates[0] as StoredRelayState).savedAt, "2026-07-07T00:00:01.000Z");
});

test("relay store persistence close flushes pending work and closes backend", async () => {
  let saves = 0;
  let closed = false;
  const persistence: RelayPersistence = {
    flushMode: "debounced",
    async load() {
      return null;
    },
    async save() {
      saves += 1;
    },
    async saveEncryptedBacklog() {
      return false;
    },
    async saveEncryptedEnvelope() {
      return false;
    },
    async quarantine() {},
    close() {
      closed = true;
    }
  };
  const storeCodec: RelayStoreCodec = {
    isExpiredInvite() {
      return false;
    },
    isExpiredAttachmentBlob() {
      return false;
    },
    applyStoredRelayState() {},
    pruneExpiredRelayState() {},
    toStoredRelayState() {
      return storedState(1);
    }
  };
  const coordinator = createRelayStorePersistenceCoordinator({
    dataPath: "memory",
    persistence,
    storeCodec
  });

  coordinator.scheduleStoreSave();
  await coordinator.closeRelayStore();
  await delay(150);

  assert.equal(saves, 1);
  assert.equal(closed, true);
});

test("relay store persistence close waits for pending encrypted envelope saves", async () => {
  let fullSaves = 0;
  let encryptedSaveResolved = false;
  let closed = false;
  const persistence: RelayPersistence = {
    flushMode: "debounced",
    async load() {
      return null;
    },
    async save() {
      fullSaves += 1;
      assert.equal(encryptedSaveResolved, true);
    },
    async saveEncryptedBacklog() {
      return false;
    },
    async saveEncryptedEnvelope() {
      await delay(75);
      encryptedSaveResolved = true;
      return true;
    },
    async quarantine() {},
    close() {
      closed = true;
      assert.equal(encryptedSaveResolved, true);
    }
  };
  const storeCodec: RelayStoreCodec = {
    isExpiredInvite() {
      return false;
    },
    isExpiredAttachmentBlob() {
      return false;
    },
    applyStoredRelayState() {},
    pruneExpiredRelayState() {},
    toStoredRelayState() {
      return storedState(1);
    }
  };
  const coordinator = createRelayStorePersistenceCoordinator({
    dataPath: "memory",
    persistence,
    storeCodec
  });

  coordinator.saveEncryptedEnvelope(
    "team:room",
    {
      id: "envelope-close",
      teamId: "team",
      roomId: "room",
      senderUserId: "user",
      senderDeviceId: "device",
      kind: "chat.message",
      createdAt: "2026-07-07T00:00:01.000Z",
      payload: {
        algorithm: "AES-GCM-256",
        nonce: "nonce",
        ciphertext: "ciphertext"
      }
    },
    []
  );

  await coordinator.closeRelayStore();

  assert.equal(encryptedSaveResolved, true);
  assert.equal(fullSaves, 1);
  assert.equal(closed, true);
});

test("relay store persistence uses incremental encrypted backlog saves when available", async () => {
  let fullSaves = 0;
  const backlogSaves: Array<{ roomKey: RoomKey; envelopes: RelayEnvelope[] }> = [];
  const persistence: RelayPersistence = {
    flushMode: "debounced",
    async load() {
      return null;
    },
    async save() {
      fullSaves += 1;
    },
    async saveEncryptedBacklog(roomKey, envelopes) {
      backlogSaves.push({ roomKey, envelopes });
      return true;
    },
    async saveEncryptedEnvelope() {
      return false;
    },
    async quarantine() {},
    close() {}
  };
  const storeCodec: RelayStoreCodec = {
    isExpiredInvite() {
      return false;
    },
    isExpiredAttachmentBlob() {
      return false;
    },
    applyStoredRelayState() {},
    pruneExpiredRelayState() {},
    toStoredRelayState() {
      return storedState(1);
    }
  };
  const coordinator = createRelayStorePersistenceCoordinator({
    dataPath: "memory",
    persistence,
    storeCodec
  });

  coordinator.saveEncryptedBacklog("team:room", [
    {
      id: "envelope-a",
      teamId: "team",
      roomId: "room",
      senderUserId: "user",
      senderDeviceId: "device",
      kind: "chat.message",
      createdAt: "2026-07-07T00:00:00.000Z",
      payload: {
        algorithm: "AES-GCM-256",
        nonce: "nonce",
        ciphertext: "ciphertext"
      }
    }
  ]);
  await delay(150);

  assert.equal(backlogSaves.length, 1);
  assert.equal(backlogSaves[0]?.roomKey, "team:room");
  assert.equal(backlogSaves[0]?.envelopes[0]?.id, "envelope-a");
  assert.equal(fullSaves, 0);
});

test("relay store persistence uses incremental encrypted envelope append when available", async () => {
  let fullSaves = 0;
  const envelopeSaves: Array<{ roomKey: RoomKey; envelope: RelayEnvelope; prunedEnvelopeIds: string[] }> = [];
  const persistence: RelayPersistence = {
    flushMode: "debounced",
    async load() {
      return null;
    },
    async save() {
      fullSaves += 1;
    },
    async saveEncryptedBacklog() {
      return false;
    },
    async saveEncryptedEnvelope(roomKey, envelope, prunedEnvelopeIds) {
      envelopeSaves.push({ roomKey, envelope, prunedEnvelopeIds });
      return true;
    },
    async quarantine() {},
    close() {}
  };
  const storeCodec: RelayStoreCodec = {
    isExpiredInvite() {
      return false;
    },
    isExpiredAttachmentBlob() {
      return false;
    },
    applyStoredRelayState() {},
    pruneExpiredRelayState() {},
    toStoredRelayState() {
      return storedState(1);
    }
  };
  const coordinator = createRelayStorePersistenceCoordinator({
    dataPath: "memory",
    persistence,
    storeCodec
  });
  const envelope: RelayEnvelope = {
    id: "envelope-b",
    teamId: "team",
    roomId: "room",
    senderUserId: "user",
    senderDeviceId: "device",
    kind: "chat.message",
    createdAt: "2026-07-07T00:00:01.000Z",
    payload: {
      algorithm: "AES-GCM-256",
      nonce: "nonce",
      ciphertext: "ciphertext"
    }
  };

  coordinator.saveEncryptedEnvelope("team:room", envelope, ["envelope-a"]);
  await delay(150);

  assert.equal(envelopeSaves.length, 1);
  assert.equal(envelopeSaves[0]?.roomKey, "team:room");
  assert.equal(envelopeSaves[0]?.envelope.id, "envelope-b");
  assert.deepEqual(envelopeSaves[0]?.prunedEnvelopeIds, ["envelope-a"]);
  assert.equal(fullSaves, 0);
});

test("relay store persistence falls back to full save when encrypted envelope append is unsupported", async () => {
  let fullSaves = 0;
  const persistence: RelayPersistence = {
    flushMode: "debounced",
    async load() {
      return null;
    },
    async save() {
      fullSaves += 1;
    },
    async saveEncryptedBacklog() {
      return false;
    },
    async saveEncryptedEnvelope() {
      return false;
    },
    async quarantine() {},
    close() {}
  };
  const storeCodec: RelayStoreCodec = {
    isExpiredInvite() {
      return false;
    },
    isExpiredAttachmentBlob() {
      return false;
    },
    applyStoredRelayState() {},
    pruneExpiredRelayState() {},
    toStoredRelayState() {
      return storedState(1);
    }
  };
  const coordinator = createRelayStorePersistenceCoordinator({
    dataPath: "memory",
    persistence,
    storeCodec
  });

  coordinator.saveEncryptedEnvelope(
    "team:room",
    {
      id: "envelope-c",
      teamId: "team",
      roomId: "room",
      senderUserId: "user",
      senderDeviceId: "device",
      kind: "chat.message",
      createdAt: "2026-07-07T00:00:02.000Z",
      payload: {
        algorithm: "AES-GCM-256",
        nonce: "nonce",
        ciphertext: "ciphertext"
      }
    },
    []
  );
  await delay(150);

  assert.equal(fullSaves, 1);
});

test("relay store persistence falls back to full save when encrypted backlog saves are unsupported", async () => {
  let fullSaves = 0;
  const persistence: RelayPersistence = {
    flushMode: "debounced",
    async load() {
      return null;
    },
    async save() {
      fullSaves += 1;
    },
    async saveEncryptedBacklog() {
      return false;
    },
    async saveEncryptedEnvelope() {
      return false;
    },
    async quarantine() {},
    close() {}
  };
  const storeCodec: RelayStoreCodec = {
    isExpiredInvite() {
      return false;
    },
    isExpiredAttachmentBlob() {
      return false;
    },
    applyStoredRelayState() {},
    pruneExpiredRelayState() {},
    toStoredRelayState() {
      return storedState(1);
    }
  };
  const coordinator = createRelayStorePersistenceCoordinator({
    dataPath: "memory",
    persistence,
    storeCodec
  });

  coordinator.saveEncryptedBacklog("team:room", []);
  await delay(150);

  assert.equal(fullSaves, 1);
});
