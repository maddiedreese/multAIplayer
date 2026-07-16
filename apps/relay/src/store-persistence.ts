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

type StoredRelayMutation = ReturnType<RelayStoreCodec["drainStoredRelayMutations"]>[number];
type PersistenceHealth = "healthy" | "poisoned";

interface PendingMutationBatch {
  /** The exact mutation snapshot handed to one SQLite unit of work. */
  readonly changes: StoredRelayMutation[];
}

type PersistenceFailureDisposition = "expected_conflict" | "poison";

function classifyPersistenceFailure(error: unknown): PersistenceFailureDisposition {
  return error instanceof RelayStaleEpochError ? "expected_conflict" : "poison";
}

export function createRelayStorePersistenceCoordinator(options: {
  dataPath: string;
  persistence: RelayPersistence;
  storeCodec: RelayStoreCodec;
  onPoison?: () => void;
}): RelayStorePersistenceCoordinator {
  let pendingChanges: StoredRelayMutation[] = [];
  let health: PersistenceHealth = "healthy";

  function isHealthy() {
    return health === "healthy";
  }

  function ensureHealthy() {
    if (health === "poisoned") throw new RelayPersistenceUnavailableError();
  }

  function persistenceWrite<T>(write: () => T): T {
    ensureHealthy();
    try {
      return write();
    } catch (error) {
      if (classifyPersistenceFailure(error) === "expected_conflict") throw error;
      if (health === "healthy") {
        health = "poisoned";
        logRelayEvent("error", "relay_store_persistence_poisoned");
        options.onPoison?.();
      }
      throw new RelayPersistenceUnavailableError(error);
    }
  }

  function collectPendingChanges(): PendingMutationBatch | null {
    const latest = new Map<string, StoredRelayMutation>();
    for (const change of [...pendingChanges, ...options.storeCodec.drainStoredRelayMutations()]) {
      latest.set(`${change.entity}\0${change.key}`, change);
    }
    pendingChanges = Array.from(latest.values());
    return pendingChanges.length === 0 ? null : { changes: pendingChanges };
  }

  /**
   * A drained batch remains pending until the database unit of work returns.
   * Expected optimistic conflicts may therefore be retried; unexpected write
   * failures poison the coordinator and no later request may attempt a retry.
   */
  function acknowledgeMutationBatch(batch: PendingMutationBatch): void {
    if (pendingChanges === batch.changes) pendingChanges = [];
  }

  function savePendingChanges(): void {
    ensureHealthy();
    const batch = collectPendingChanges();
    if (!batch) return;
    persistenceWrite(() => options.persistence.saveChanges(batch.changes));
    acknowledgeMutationBatch(batch);
  }

  async function loadRelayStore() {
    try {
      const stored = await options.persistence.load();
      if (stored === null) return;
      if (!isRecord(stored) || stored.version !== 1) {
        logRelayEvent("warn", "unsupported_store_version");
        throw new RelayPersistenceLoadError("Relay store version is unsupported; operator recovery is required.");
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
      throw new RelayPersistenceLoadError(
        "Relay store could not be read; refusing to start with replacement state.",
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
    const batch = collectPendingChanges();
    persistenceWrite(() => options.persistence.saveKeyPackages(batch?.changes ?? []));
    if (batch) acknowledgeMutationBatch(batch);
    return Promise.resolve();
  }

  function saveMlsMessage(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]) {
    const batch = collectPendingChanges();
    persistenceWrite(() => options.persistence.saveMlsMessage(roomKey, message, prunedIds, batch?.changes ?? []));
    if (batch) acknowledgeMutationBatch(batch);
    return Promise.resolve();
  }

  function saveMlsCommit(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]) {
    const batch = collectPendingChanges();
    persistenceWrite(() => options.persistence.saveMlsCommit(roomKey, message, prunedIds, batch?.changes ?? []));
    if (batch) acknowledgeMutationBatch(batch);
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
