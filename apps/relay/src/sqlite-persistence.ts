import Database from "better-sqlite3";
import { chmod, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { type MlsRelayMessage } from "@multaiplayer/protocol";
import type { RelayPersistence, StoredRelayMutation } from "./persistence-types.js";
import { openRelayDatabase } from "./sqlite-schema.js";
import {
  appendMlsBacklogRow,
  applyStoredRelayMutations,
  applyStoredRelayMutationsInTransaction,
  loadNormalizedRelayState,
  saveMlsBacklogRows,
  saveNormalizedRelayState
} from "./sqlite-state-repository.js";
import type { RoomKey } from "./state.js";

export class SqliteRelayPersistence implements RelayPersistence {
  private db: Database.Database | null = null;
  constructor(
    private readonly dataPath: string,
    private readonly recordWriteDuration: (durationMs: number) => void = () => undefined,
    private readonly sqliteWalAutoCheckpointPages = 1_000
  ) {}

  async load(): Promise<unknown | null> {
    await ensureDataDirectory(dirname(this.dataPath));
    const db = this.getDb();
    return loadNormalizedRelayState(db);
  }

  async save(state: unknown): Promise<void> {
    await ensureDataDirectory(dirname(this.dataPath));
    this.timedWrite(() => saveNormalizedRelayState(this.getDb(), state));
  }
  saveChanges(changes: StoredRelayMutation[]): void {
    if (changes.length > 0) this.timedWrite(() => applyStoredRelayMutations(this.getDb(), changes));
  }
  saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): void {
    this.timedWrite(() => saveMlsBacklogRows(this.getDb(), roomKey, messages));
  }
  saveKeyPackages(changes: StoredRelayMutation[]): void {
    this.timedWrite(() => applyStoredRelayMutations(this.getDb(), changes));
  }
  saveMlsMessage(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedIds: string[],
    changes: StoredRelayMutation[]
  ): void {
    this.timedWrite(() =>
      this.getDb().transaction(() => {
        appendMlsBacklogRow(this.getDb(), roomKey, message, prunedIds);
        applyStoredRelayMutationsInTransaction(this.getDb(), changes, new Set(["mlsBacklog"]));
      })()
    );
  }
  saveMlsCommit(roomKey: RoomKey, message: MlsRelayMessage, prunedIds: string[], changes: StoredRelayMutation[]): void {
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
  private getDb(): Database.Database {
    return (this.db ??= openRelayDatabase(this.dataPath, this.sqliteWalAutoCheckpointPages));
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

export class RelayStaleEpochError extends Error {
  override readonly name = "RelayStaleEpochError";
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
