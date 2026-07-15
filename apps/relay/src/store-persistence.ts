import { isRecord, type MlsRelayMessage } from "@multaiplayer/protocol";
import { logRelayEvent } from "./observability.js";
import { RelayPersistenceMigrationError, type RelayPersistence } from "./persistence.js";
import type { RoomKey } from "./state.js";
import type { RelayStoreCodec } from "./store-codec.js";

export interface RelayStorePersistenceCoordinator {
  loadRelayStore(): Promise<void>;
  scheduleStoreSave(): void;
  saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): void;
  saveKeyPackages(): Promise<void>;
  saveMlsMessage(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]): Promise<void>;
  saveMlsCommit(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]): Promise<void>;
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
  const pendingSaves = new Set<Promise<void>>();
  let pendingChanges: ReturnType<RelayStoreCodec["drainStoredRelayMutations"]> = [];

  function trackSave(save: Promise<void>) {
    const tracked = save.finally(() => {
      pendingSaves.delete(tracked);
    });
    pendingSaves.add(tracked);
  }

  async function waitForPendingSaves() {
    while (pendingSaves.size > 0) {
      await Promise.allSettled([...pendingSaves]);
    }
  }

  function collectPendingChanges() {
    const latest = new Map<string, (typeof pendingChanges)[number]>();
    for (const change of [...pendingChanges, ...options.storeCodec.drainStoredRelayMutations()]) {
      latest.set(`${change.entity}\0${change.key}`, change);
    }
    pendingChanges = Array.from(latest.values());
  }

  async function savePendingChanges(): Promise<boolean> {
    collectPendingChanges();
    if (pendingChanges.length === 0) return options.persistence.flushMode === "immediate";
    const changes = pendingChanges;
    const handled = await options.persistence.saveChanges(changes);
    if (handled) pendingChanges = pendingChanges === changes ? [] : pendingChanges;
    return handled;
  }

  async function loadRelayStore() {
    try {
      const stored = await options.persistence.load();
      if (stored === null) return;
      if (!isRecord(stored) || stored.version !== 1) {
        logRelayEvent("warn", "unsupported_store_version_quarantined");
        await options.persistence.quarantine("unsupported-version");
        return;
      }
      options.storeCodec.applyStoredRelayState(stored);
      await options.persistence.finalizeLoad?.(() => options.storeCodec.toStoredRelayState());
      if (hasLegacyAuthTokenFields(stored)) {
        await options.persistence.save(options.storeCodec.toStoredRelayState());
        logRelayEvent("info", "legacy_auth_token_fields_purged");
      }
      options.storeCodec.discardStoredRelayMutations();
      pendingChanges = [];
      logRelayEvent("info", "relay_store_loaded");
    } catch (error) {
      if (error instanceof RelayPersistenceMigrationError) throw error;
      logRelayEvent("warn", "relay_store_load_failed");
      await options.persistence.quarantine("unreadable");
    }
  }

  function scheduleStoreSave() {
    if (options.persistence.flushMode === "immediate") {
      const save = savePendingChanges()
        .then(() => undefined)
        .catch(() => {
          logRelayEvent("error", "relay_store_save_failed");
        });
      trackSave(save);
      return;
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveRelayStore().catch(() => {
        logRelayEvent("error", "relay_store_save_failed");
      });
    }, 100);
  }

  function saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]) {
    trackSave(
      options.persistence
        .saveMlsBacklog(roomKey, messages)
        .then(async (handled) => {
          if (!handled) scheduleStoreSave();
          else await savePendingChanges();
        })
        .catch(() => {
          logRelayEvent("error", "mls_backlog_save_failed");
          scheduleStoreSave();
        })
    );
  }

  function saveKeyPackages() {
    if (options.persistence.flushMode === "debounced") options.storeCodec.pruneExpiredRelayState();
    collectPendingChanges();
    const changes = pendingChanges;
    const save = options.persistence
      .saveKeyPackages(changes, () => options.storeCodec.toStoredRelayState())
      .then(() => {
        if (pendingChanges === changes) pendingChanges = [];
      });
    trackSave(save);
    return save;
  }

  function saveMlsMessage(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]) {
    if (options.persistence.flushMode === "debounced") options.storeCodec.pruneExpiredRelayState();
    collectPendingChanges();
    const changes = pendingChanges;
    const save = options.persistence
      .saveMlsMessage(roomKey, message, prunedIds, changes, () => options.storeCodec.toStoredRelayState())
      .then(async (handled) => {
        if (pendingChanges === changes) pendingChanges = [];
        if (!handled) await saveRelayStore();
      });
    trackSave(save);
    return save;
  }

  function saveMlsCommit(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]) {
    if (options.persistence.flushMode === "debounced") options.storeCodec.pruneExpiredRelayState();
    collectPendingChanges();
    const changes = pendingChanges;
    const save = options.persistence
      .saveMlsCommit(roomKey, message, prunedIds, changes, () => options.storeCodec.toStoredRelayState())
      .then(() => {
        if (pendingChanges === changes) pendingChanges = [];
      });
    trackSave(save);
    return save;
  }

  async function saveRelayStore() {
    if (options.persistence.flushMode === "immediate") {
      await savePendingChanges();
      return;
    }
    options.storeCodec.pruneExpiredRelayState();
    if (await savePendingChanges()) return;
    await options.persistence.save(options.storeCodec.toStoredRelayState());
    options.storeCodec.discardStoredRelayMutations();
    pendingChanges = [];
  }

  async function flushRelayStore() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await waitForPendingSaves();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (options.persistence.flushMode === "immediate") options.storeCodec.pruneExpiredRelayState();
    await saveRelayStore();
  }

  async function closeRelayStore() {
    await flushRelayStore();
    options.persistence.close();
  }

  return {
    loadRelayStore,
    scheduleStoreSave,
    saveMlsBacklog,
    saveKeyPackages,
    saveMlsMessage,
    saveMlsCommit,
    saveRelayStore,
    flushRelayStore,
    closeRelayStore
  };
}

function hasLegacyAuthTokenFields(stored: Record<string, unknown>): boolean {
  if (!Array.isArray(stored.authSessions)) return false;
  return stored.authSessions.some(
    (session) => isRecord(session) && ("accessToken" in session || "encryptedAccessToken" in session)
  );
}
