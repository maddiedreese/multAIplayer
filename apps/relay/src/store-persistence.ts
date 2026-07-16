import { isRecord, type MlsRelayMessage } from "@multaiplayer/protocol";
import { logRelayEvent } from "./observability.js";
import { RelayStaleEpochError, type RelayPersistence } from "./persistence.js";
import { RelayStoreByteCapacityError, RelayStoreCapacityError, type RoomKey } from "./state.js";
import type { RelayStoreCodec } from "./store-codec.js";

export interface RelayStorePersistenceCoordinator {
  isHealthy(): boolean;
  loadRelayStore(): Promise<void>;
  scheduleStoreSave(): void;
  saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): void;
  saveKeyPackages(): Promise<void>;
  saveMlsMessage(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]): Promise<void>;
  saveMlsCommit(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]): Promise<void>;
  saveRelayStore(): Promise<void>;
  reclaimDurableCapacity(): Promise<void>;
  flushRelayStore(): Promise<void>;
  closeRelayStore(): Promise<void>;
}

export function createRelayStorePersistenceCoordinator(options: {
  dataPath: string;
  persistence: RelayPersistence;
  storeCodec: RelayStoreCodec;
  onPoison?: () => void;
}): RelayStorePersistenceCoordinator {
  let pendingChanges: ReturnType<RelayStoreCodec["drainStoredRelayMutations"]> = [];
  let poisoned = false;

  function isHealthy() {
    return !poisoned;
  }

  function ensureHealthy() {
    if (poisoned) throw new RelayPersistenceUnavailableError();
  }

  function persistenceWrite<T>(write: () => T): T {
    ensureHealthy();
    try {
      return write();
    } catch (error) {
      if (error instanceof RelayStaleEpochError) throw error;
      if (!poisoned) {
        poisoned = true;
        logRelayEvent("error", "relay_store_persistence_poisoned");
        options.onPoison?.();
      }
      throw new RelayPersistenceUnavailableError(error);
    }
  }

  function collectPendingChanges() {
    const latest = new Map<string, (typeof pendingChanges)[number]>();
    for (const change of [...pendingChanges, ...options.storeCodec.drainStoredRelayMutations()]) {
      latest.set(`${change.entity}\0${change.key}`, change);
    }
    pendingChanges = Array.from(latest.values());
  }

  function savePendingChanges(): void {
    ensureHealthy();
    collectPendingChanges();
    if (pendingChanges.length === 0) return;
    const changes = pendingChanges;
    persistenceWrite(() => options.persistence.saveChanges(changes));
    if (pendingChanges === changes) pendingChanges = [];
  }

  async function loadRelayStore() {
    try {
      const stored = await options.persistence.load();
      if (stored === null) return;
      if (!isRecord(stored) || stored.version !== 1) {
        logRelayEvent("warn", "unsupported_store_version_quarantined");
        await options.persistence.quarantine("unsupported-version");
        throw new RelayPersistenceLoadError(
          "Relay store version is unsupported; quarantined evidence requires operator recovery."
        );
      }
      options.storeCodec.applyStoredRelayState(stored);
      options.storeCodec.discardStoredRelayMutations();
      pendingChanges = [];
      logRelayEvent("info", "relay_store_loaded");
    } catch (error) {
      if (
        error instanceof RelayStoreCapacityError ||
        error instanceof RelayStoreByteCapacityError ||
        error instanceof RelayPersistenceLoadError
      )
        throw error;
      logRelayEvent("warn", "relay_store_load_failed");
      await options.persistence.quarantine("unreadable");
      throw new RelayPersistenceLoadError(
        "Relay store could not be read and was quarantined; refusing to start with replacement state.",
        error
      );
    }
  }

  function scheduleStoreSave() {
    savePendingChanges();
  }

  function saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]) {
    persistenceWrite(() => options.persistence.saveMlsBacklog(roomKey, messages));
    savePendingChanges();
  }

  function saveKeyPackages() {
    collectPendingChanges();
    const changes = pendingChanges;
    persistenceWrite(() => options.persistence.saveKeyPackages(changes));
    if (pendingChanges === changes) pendingChanges = [];
    return Promise.resolve();
  }

  function saveMlsMessage(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]) {
    collectPendingChanges();
    const changes = pendingChanges;
    persistenceWrite(() => options.persistence.saveMlsMessage(roomKey, message, prunedIds, changes));
    if (pendingChanges === changes) pendingChanges = [];
    return Promise.resolve();
  }

  function saveMlsCommit(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]) {
    collectPendingChanges();
    const changes = pendingChanges;
    persistenceWrite(() => options.persistence.saveMlsCommit(roomKey, message, prunedIds, changes));
    if (pendingChanges === changes) pendingChanges = [];
    return Promise.resolve();
  }

  function saveRelayStore(): Promise<void> {
    savePendingChanges();
    return Promise.resolve();
  }

  async function reclaimDurableCapacity() {
    options.storeCodec.pruneExpiredRelayState();
    await saveRelayStore();
  }

  async function flushRelayStore() {
    options.storeCodec.pruneExpiredRelayState();
    await saveRelayStore();
  }

  async function closeRelayStore() {
    try {
      if (isHealthy()) await flushRelayStore();
    } finally {
      options.persistence.close();
    }
  }

  return {
    isHealthy,
    loadRelayStore,
    scheduleStoreSave,
    saveMlsBacklog,
    saveKeyPackages,
    saveMlsMessage,
    saveMlsCommit,
    saveRelayStore,
    reclaimDurableCapacity,
    flushRelayStore,
    closeRelayStore
  };
}

export class RelayPersistenceUnavailableError extends Error {
  override readonly name = "RelayPersistenceUnavailableError";

  constructor(cause?: unknown) {
    super("Relay persistence is unavailable; restart the relay before serving more traffic.", { cause });
  }
}

export class RelayPersistenceLoadError extends Error {
  override readonly name = "RelayPersistenceLoadError";
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}
