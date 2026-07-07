import { isRecord } from "./limits.js";
import type { RelayEnvelope } from "@multaiplayer/protocol";
import type { RelayPersistence } from "./persistence.js";
import type { RoomKey } from "./state.js";
import type { RelayStoreCodec } from "./store-codec.js";

export interface RelayStorePersistenceCoordinator {
  loadRelayStore(): Promise<void>;
  scheduleStoreSave(): void;
  saveEncryptedBacklog(roomKey: RoomKey, envelopes: RelayEnvelope[]): void;
  saveEncryptedEnvelope(roomKey: RoomKey, envelope: RelayEnvelope, prunedEnvelopeIds: string[]): void;
  saveRelayStore(): Promise<void>;
  flushRelayStore(): Promise<void>;
  closeRelayStore(): Promise<void>;
}

export function createRelayStorePersistenceCoordinator(options: {
  dataPath: string;
  persistence: RelayPersistence;
  storeCodec: RelayStoreCodec;
}): RelayStorePersistenceCoordinator {
  let saveTimer: NodeJS.Timeout | null = null;

  async function loadRelayStore() {
    try {
      const stored = await options.persistence.load();
      if (stored === null) return;
      if (!isRecord(stored) || stored.version !== 1) {
        console.warn(`Ignoring unsupported relay store version at ${options.dataPath}`);
        await options.persistence.quarantine("unsupported-version");
        return;
      }
      options.storeCodec.applyStoredRelayState(stored);
      console.log(`Loaded multAIplayer relay store from ${options.dataPath}`);
    } catch (error) {
      console.warn(`Could not load relay store at ${options.dataPath}:`, error);
      await options.persistence.quarantine("unreadable");
    }
  }

  function scheduleStoreSave() {
    if (options.persistence.flushMode === "immediate") {
      saveRelayStore().catch((error) => {
        console.error("Failed to save relay store:", error);
      });
      return;
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveRelayStore().catch((error) => {
        console.error("Failed to save relay store:", error);
      });
    }, 100);
  }

  function saveEncryptedBacklog(roomKey: RoomKey, envelopes: RelayEnvelope[]) {
    options.persistence.saveEncryptedBacklog(roomKey, envelopes)
      .then((handled) => {
        if (!handled) scheduleStoreSave();
      })
      .catch((error) => {
        console.error("Failed to save encrypted relay backlog:", error);
        scheduleStoreSave();
      });
  }

  function saveEncryptedEnvelope(roomKey: RoomKey, envelope: RelayEnvelope, prunedEnvelopeIds: string[]) {
    options.persistence.saveEncryptedEnvelope(roomKey, envelope, prunedEnvelopeIds)
      .then((handled) => {
        if (!handled) scheduleStoreSave();
      })
      .catch((error) => {
        console.error("Failed to append encrypted relay envelope:", error);
        scheduleStoreSave();
      });
  }

  async function saveRelayStore() {
    options.storeCodec.pruneExpiredRelayState();
    await options.persistence.save(options.storeCodec.toStoredRelayState());
  }

  async function flushRelayStore() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await saveRelayStore();
  }

  async function closeRelayStore() {
    await flushRelayStore();
    options.persistence.close();
  }

  return {
    loadRelayStore,
    scheduleStoreSave,
    saveEncryptedBacklog,
    saveEncryptedEnvelope,
    saveRelayStore,
    flushRelayStore,
    closeRelayStore
  };
}
