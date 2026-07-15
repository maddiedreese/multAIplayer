import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { isRecord, type MlsRelayMessage } from "@multaiplayer/protocol";
import { logRelayEvent } from "./observability.js";
import type { RelayPersistence, StoredRelayMutation } from "./persistence-types.js";
import { openRelayDatabase } from "./sqlite-schema.js";
import {
  appendMlsBacklogRow,
  applyStoredRelayMutations,
  applyStoredRelayMutationsInTransaction,
  loadNormalizedRelayState,
  purgeLegacyRoomConfigFields,
  saveMlsBacklogRows,
  saveNormalizedRelayState
} from "./sqlite-state-repository.js";
import type { RoomKey } from "./state.js";

export class SqliteRelayPersistence implements RelayPersistence {
  readonly flushMode = "immediate";
  private db: Database.Database | null = null;
  private pendingLegacyImport = false;

  constructor(
    private readonly dataPath: string,
    private readonly legacyJsonImportPath: string | null,
    private readonly renameLegacyFile: typeof rename = rename,
    private readonly recordWriteDuration: (durationMs: number) => void = () => undefined
  ) {}

  async load(): Promise<unknown | null> {
    await ensureDataDirectory(dirname(this.dataPath));
    const db = this.getDb();
    const normalized = loadNormalizedRelayState(db);
    if (normalized !== null) {
      await this.finishInterruptedLegacyBackup(db);
      return normalized;
    }
    const row = db.prepare("select state_json from relay_snapshots where id = ?").get("current") as
      { state_json?: unknown } | undefined;
    if (typeof row?.state_json === "string") return JSON.parse(row.state_json) as unknown;
    if (!this.legacyJsonImportPath || !existsSync(this.legacyJsonImportPath)) return null;
    try {
      const legacyState = JSON.parse(await readFile(this.legacyJsonImportPath, "utf8")) as unknown;
      if (!isRecord(legacyState) || legacyState.version !== 1)
        throw new Error("Legacy relay store has an unsupported version.");
      this.pendingLegacyImport = true;
      return legacyState;
    } catch (error) {
      throw new RelayPersistenceMigrationError(`Could not import legacy relay store at ${this.legacyJsonImportPath}`, {
        cause: error
      });
    }
  }

  async finalizeLoad(state: () => unknown): Promise<void> {
    if (!this.pendingLegacyImport || !this.legacyJsonImportPath) {
      const normalized = state();
      const normalizedRooms = isRecord(normalized) && Array.isArray(normalized.rooms) ? normalized.rooms : null;
      if (normalizedRooms) this.timedWrite(() => purgeLegacyRoomConfigFields(this.getDb(), normalizedRooms));
      return;
    }
    this.timedWrite(() => saveNormalizedRelayState(this.getDb(), state(), this.legacyJsonImportPath!));
    try {
      await this.renameLegacyFile(this.legacyJsonImportPath, availableMigrationBackupPath(this.legacyJsonImportPath));
    } catch (error) {
      throw new RelayPersistenceMigrationError(
        `Could not preserve migrated legacy relay store at ${this.legacyJsonImportPath}`,
        { cause: error }
      );
    }
    this.pendingLegacyImport = false;
  }

  private async finishInterruptedLegacyBackup(db: Database.Database): Promise<void> {
    if (!this.legacyJsonImportPath || !existsSync(this.legacyJsonImportPath)) return;
    const marker = db.prepare("select value from relay_meta where key = ?").get("legacyJsonImportedFrom") as
      { value?: unknown } | undefined;
    if (marker?.value !== this.legacyJsonImportPath) return;
    try {
      await this.renameLegacyFile(this.legacyJsonImportPath, availableMigrationBackupPath(this.legacyJsonImportPath));
    } catch (error) {
      throw new RelayPersistenceMigrationError(
        `Could not preserve migrated legacy relay store at ${this.legacyJsonImportPath}`,
        { cause: error }
      );
    }
  }

  async save(state: unknown): Promise<void> {
    await ensureDataDirectory(dirname(this.dataPath));
    this.timedWrite(() => saveNormalizedRelayState(this.getDb(), state));
  }
  async saveChanges(changes: StoredRelayMutation[]): Promise<boolean> {
    if (changes.length > 0) this.timedWrite(() => applyStoredRelayMutations(this.getDb(), changes));
    return true;
  }
  async saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): Promise<boolean> {
    this.timedWrite(() => saveMlsBacklogRows(this.getDb(), roomKey, messages));
    return true;
  }
  async saveKeyPackages(changes: StoredRelayMutation[], _fallbackState: () => unknown): Promise<void> {
    this.timedWrite(() => applyStoredRelayMutations(this.getDb(), changes));
  }
  async saveMlsMessage(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedIds: string[],
    changes: StoredRelayMutation[],
    _fallbackState: () => unknown
  ): Promise<boolean> {
    this.timedWrite(() =>
      this.getDb().transaction(() => {
        appendMlsBacklogRow(this.getDb(), roomKey, message, prunedIds);
        applyStoredRelayMutationsInTransaction(this.getDb(), changes, new Set(["mlsBacklog"]));
      })()
    );
    return true;
  }
  async saveMlsCommit(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedIds: string[],
    changes: StoredRelayMutation[],
    _fallbackState: () => unknown
  ): Promise<void> {
    this.timedWrite(() =>
      this.getDb().transaction(() => {
        this.getDb().prepare("insert or ignore into relay_room_epochs values (?, ?)").run(roomKey, message.epochHint);
        const advanced = this.getDb()
          .prepare("update relay_room_epochs set accepted_epoch = ? where room_key = ? and accepted_epoch = ?")
          .run(message.epochHint + 1, roomKey, message.epochHint);
        if (advanced.changes !== 1) throw new RelayStaleEpochError();
        appendMlsBacklogRow(this.getDb(), roomKey, message, prunedIds);
        applyStoredRelayMutationsInTransaction(this.getDb(), changes, new Set(["mlsBacklog"]));
      })()
    );
  }
  async quarantine(reason: string): Promise<void> {
    this.close();
    await Promise.all([
      quarantinePath(this.dataPath, reason),
      quarantinePath(`${this.dataPath}-wal`, reason),
      quarantinePath(`${this.dataPath}-shm`, reason)
    ]);
  }
  private getDb(): Database.Database {
    return (this.db ??= openRelayDatabase(this.dataPath));
  }
  private timedWrite<T>(write: () => T): T {
    const startedAt = performance.now();
    try {
      return write();
    } finally {
      this.recordWriteDuration(performance.now() - startedAt);
    }
  }
  close() {
    this.db?.close();
    this.db = null;
  }
}

export class RelayPersistenceMigrationError extends Error {
  override readonly name = "RelayPersistenceMigrationError";
}
export class RelayStaleEpochError extends Error {
  override readonly name = "RelayStaleEpochError";
}

function availableMigrationBackupPath(legacyPath: string): string {
  const base = `${legacyPath}.migrated-to-sqlite`;
  if (!existsSync(base)) return base;
  let suffix = 1;
  while (existsSync(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

async function ensureDataDirectory(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  }
}

async function quarantinePath(path: string, reason: string) {
  const backupPath = `${path}.corrupt-${reason}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    await rename(path, backupPath);
    logRelayEvent("warn", "unreadable_store_quarantined");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") logRelayEvent("error", "store_quarantine_failed");
  }
}
