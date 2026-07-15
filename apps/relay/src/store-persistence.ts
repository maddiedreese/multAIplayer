import { isRecord, type MlsRelayMessage } from "@multaiplayer/protocol";
import { logRelayEvent } from "./observability.js";
import { RelayPersistenceMigrationError, RelayStaleEpochError, type RelayPersistence } from "./persistence.js";
import { RelayStoreCapacityError, type RoomKey } from "./state.js";
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
    persistenceWrite(() => {
      if (!options.persistence.saveChanges(changes)) {
        throw new Error("Relay persistence rejected a durable mutation batch.");
      }
    });
    if (pendingChanges === changes) pendingChanges = [];
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
      if (hasLegacyAuthSessionFields(stored)) {
        await options.persistence.save(options.storeCodec.toStoredRelayState());
        logRelayEvent("info", "legacy_auth_session_fields_purged");
      }
      options.storeCodec.discardStoredRelayMutations();
      pendingChanges = [];
      logRelayEvent("info", "relay_store_loaded");
    } catch (error) {
      if (error instanceof RelayPersistenceMigrationError || error instanceof RelayStoreCapacityError) throw error;
      logRelayEvent("warn", "relay_store_load_failed");
      await options.persistence.quarantine("unreadable");
    }
  }

  function scheduleStoreSave() {
    savePendingChanges();
  }

  function saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]) {
    persistenceWrite(() => {
      if (!options.persistence.saveMlsBacklog(roomKey, messages)) {
        throw new Error("Relay persistence rejected an MLS backlog write.");
      }
    });
    savePendingChanges();
  }

  function saveKeyPackages() {
    collectPendingChanges();
    const changes = pendingChanges;
    persistenceWrite(() => options.persistence.saveKeyPackages(changes, () => options.storeCodec.toStoredRelayState()));
    if (pendingChanges === changes) pendingChanges = [];
    return Promise.resolve();
  }

  function saveMlsMessage(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]) {
    collectPendingChanges();
    const changes = pendingChanges;
    persistenceWrite(() => {
      if (
        !options.persistence.saveMlsMessage(roomKey, message, prunedIds, changes, () =>
          options.storeCodec.toStoredRelayState()
        )
      ) {
        throw new Error("Relay persistence rejected an MLS message write.");
      }
    });
    if (pendingChanges === changes) pendingChanges = [];
    return Promise.resolve();
  }

  function saveMlsCommit(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[]) {
    collectPendingChanges();
    const changes = pendingChanges;
    persistenceWrite(() =>
      options.persistence.saveMlsCommit(roomKey, message, prunedIds, changes, () =>
        options.storeCodec.toStoredRelayState()
      )
    );
    if (pendingChanges === changes) pendingChanges = [];
    return Promise.resolve();
  }

  function saveRelayStore(): Promise<void> {
    savePendingChanges();
    return Promise.resolve();
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

function hasLegacyAuthSessionFields(stored: Record<string, unknown>): boolean {
  if (!Array.isArray(stored.authSessions)) return false;
  return stored.authSessions.some(
    (session) =>
      isRecord(session) && ("sessionId" in session || "accessToken" in session || "encryptedAccessToken" in session)
  );
}
