import Database from "better-sqlite3";
import { chmodSync, existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import { isRecord, type MlsRelayMessage } from "@multaiplayer/protocol";
import { logRelayEvent } from "./observability.js";
import type { RoomKey } from "./state.js";

export type RelayStorageBackend = "json" | "sqlite";

export interface RelayPersistence {
  readonly flushMode: "debounced" | "immediate";
  load(): Promise<unknown | null>;
  finalizeLoad?(state: unknown): Promise<void>;
  save(state: unknown): Promise<void>;
  saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): Promise<boolean>;
  saveKeyPackages(state: unknown): Promise<void>;
  saveMlsMessage(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedMessageIds: string[],
    state: unknown
  ): Promise<boolean>;
  saveMlsCommit(roomKey: RoomKey, message: MlsRelayMessage, prunedMessageIds: string[], state: unknown): Promise<void>;
  quarantine(reason: string): Promise<void>;
  close(): void;
}

export function createRelayPersistence(options: {
  backend: RelayStorageBackend;
  dataPath: string;
  legacyJsonImportPath?: string | null;
}): RelayPersistence {
  return options.backend === "sqlite"
    ? new SqliteRelayPersistence(options.dataPath, options.legacyJsonImportPath ?? null)
    : new JsonFileRelayPersistence(options.dataPath);
}

class JsonFileRelayPersistence implements RelayPersistence {
  readonly flushMode = "debounced";

  constructor(private readonly dataPath: string) {}

  async load(): Promise<unknown | null> {
    try {
      const raw = await readFile(this.dataPath, "utf8");
      return JSON.parse(raw) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(state: unknown): Promise<void> {
    const dataDirectory = dirname(this.dataPath);
    await ensureDataDirectory(dataDirectory);
    const tempPath = `${this.dataPath}.${process.pid}.${nanoid(8)}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, this.dataPath);
    await chmod(this.dataPath, 0o600);
  }

  async finalizeLoad(): Promise<void> {}

  async saveMlsBacklog(): Promise<boolean> {
    return false;
  }

  async saveKeyPackages(state: unknown): Promise<void> {
    await this.save(state);
  }

  async saveMlsMessage(_roomKey: RoomKey, _message: MlsRelayMessage, _pruned: string[], state: unknown) {
    await this.save(state);
    return true;
  }

  async saveMlsCommit(_roomKey: RoomKey, _message: MlsRelayMessage, _prunedMessageIds: string[], state: unknown) {
    await this.save(state);
  }

  async quarantine(reason: string): Promise<void> {
    await quarantinePath(this.dataPath, reason);
  }

  close() {}
}

class SqliteRelayPersistence implements RelayPersistence {
  readonly flushMode = "debounced";
  private db: Database.Database | null = null;

  private pendingLegacyImport = false;

  constructor(
    private readonly dataPath: string,
    private readonly legacyJsonImportPath: string | null
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
    if (typeof row?.state_json !== "string") {
      if (this.legacyJsonImportPath && existsSync(this.legacyJsonImportPath)) {
        try {
          const legacyState = JSON.parse(await readFile(this.legacyJsonImportPath, "utf8")) as unknown;
          if (!isRecord(legacyState) || legacyState.version !== 1) {
            throw new Error("Legacy relay store has an unsupported version.");
          }
          this.pendingLegacyImport = true;
          return legacyState;
        } catch (error) {
          throw new RelayPersistenceMigrationError(
            `Could not import legacy relay store at ${this.legacyJsonImportPath}`,
            { cause: error }
          );
        }
      }
      return null;
    }
    return JSON.parse(row.state_json) as unknown;
  }

  async finalizeLoad(state: unknown): Promise<void> {
    if (!this.pendingLegacyImport || !this.legacyJsonImportPath) return;
    saveNormalizedRelayState(this.getDb(), state, this.legacyJsonImportPath);
    const migratedPath = availableMigrationBackupPath(this.legacyJsonImportPath);
    await rename(this.legacyJsonImportPath, migratedPath);
    this.pendingLegacyImport = false;
  }

  private async finishInterruptedLegacyBackup(db: Database.Database): Promise<void> {
    if (!this.legacyJsonImportPath || !existsSync(this.legacyJsonImportPath)) return;
    const marker = db.prepare("select value from relay_meta where key = ?").get("legacyJsonImportedFrom") as
      { value?: unknown } | undefined;
    if (marker?.value !== this.legacyJsonImportPath) return;
    try {
      await rename(this.legacyJsonImportPath, availableMigrationBackupPath(this.legacyJsonImportPath));
    } catch (error) {
      throw new RelayPersistenceMigrationError(
        `Could not preserve migrated legacy relay store at ${this.legacyJsonImportPath}`,
        { cause: error }
      );
    }
  }

  async save(state: unknown): Promise<void> {
    await ensureDataDirectory(dirname(this.dataPath));
    saveNormalizedRelayState(this.getDb(), state);
  }

  async saveMlsBacklog(roomKey: RoomKey, messages: MlsRelayMessage[]): Promise<boolean> {
    await ensureDataDirectory(dirname(this.dataPath));
    saveMlsBacklogRows(this.getDb(), roomKey, messages);
    return true;
  }

  async saveKeyPackages(state: unknown): Promise<void> {
    await ensureDataDirectory(dirname(this.dataPath));
    const db = this.getDb();
    db.transaction(() => {
      db.prepare("delete from relay_key_packages").run();
      if (!isRecord(state) || !Array.isArray(state.keyPackages)) return;
      const insert = db.prepare("insert into relay_key_packages (id, data_json) values (?, ?)");
      for (const item of state.keyPackages) {
        if (isRecord(item) && typeof item.id === "string") insert.run(item.id, JSON.stringify(item));
      }
    })();
  }

  async saveMlsMessage(
    roomKey: RoomKey,
    message: MlsRelayMessage,
    prunedMessageIds: string[],
    state: unknown
  ): Promise<boolean> {
    await ensureDataDirectory(dirname(this.dataPath));
    this.getDb().transaction(() => {
      appendMlsBacklogRow(this.getDb(), roomKey, message, prunedMessageIds);
      saveNormalizedRelayState(this.getDb(), state);
    })();
    return true;
  }

  async saveMlsCommit(roomKey: RoomKey, message: MlsRelayMessage, prunedMessageIds: string[], state: unknown) {
    await ensureDataDirectory(dirname(this.dataPath));
    this.getDb().transaction(() => {
      this.getDb()
        .prepare("insert or ignore into relay_room_epochs (room_key, accepted_epoch) values (?, ?)")
        .run(roomKey, message.epochHint);
      const advanced = this.getDb()
        .prepare("update relay_room_epochs set accepted_epoch = ? where room_key = ? and accepted_epoch = ?")
        .run(message.epochHint + 1, roomKey, message.epochHint);
      if (advanced.changes !== 1) throw new RelayStaleEpochError();
      appendMlsBacklogRow(this.getDb(), roomKey, message, prunedMessageIds);
      saveNormalizedRelayState(this.getDb(), state);
    })();
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
    if (this.db) return this.db;
    const db = new Database(this.dataPath);
    chmodSync(this.dataPath, 0o600);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      create table if not exists relay_snapshots (
        id text primary key,
        state_json text not null,
        saved_at text not null
      );
      create table if not exists relay_meta (
        key text primary key,
        value text not null
      );
      create table if not exists relay_teams (
        id text primary key,
        data_json text not null
      );
      create table if not exists relay_rooms (
        id text primary key,
        data_json text not null
      );
      create table if not exists relay_invites (
        id text primary key,
        data_json text not null
      );
      create table if not exists relay_devices (
        key text primary key,
        data_json text not null
      );
      create table if not exists relay_key_packages (
        id text primary key,
        data_json text not null
      );
      create table if not exists relay_invite_requests (id text primary key, data_json text not null);
      create table if not exists relay_invite_responses (id text primary key, data_json text not null);
      create table if not exists relay_invite_ack_receipts (id text primary key, data_json text not null);
      create table if not exists relay_accepted_message_receipts (id text primary key, data_json text not null);
      create table if not exists relay_team_members (
        team_id text primary key,
        data_json text not null
      );
      create table if not exists relay_auth_sessions (
        session_id text primary key,
        data_json text not null
      );
      create table if not exists relay_attachment_blobs (
        id text primary key,
        data_json text not null
      );
      create table if not exists relay_mls_messages (
        room_key text not null,
        message_id text not null,
        sort_order integer not null,
        created_at text not null,
        data_json text not null,
        primary key (room_key, message_id)
      )
      ;
      create table if not exists relay_room_epochs (room_key text primary key, accepted_epoch integer not null)
    `);
    secureSqliteSidecars(this.dataPath);
    this.db = db;
    return db;
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

function secureSqliteSidecars(dataPath: string) {
  for (const path of [dataPath, `${dataPath}-wal`, `${dataPath}-shm`]) {
    if (existsSync(path)) chmodSync(path, 0o600);
  }
}

function loadNormalizedRelayState(db: Database.Database): unknown | null {
  const version = db.prepare("select value from relay_meta where key = ?").get("version") as
    { value?: unknown } | undefined;
  if (version?.value !== "1") return null;
  const savedAt = db.prepare("select value from relay_meta where key = ?").get("savedAt") as
    { value?: unknown } | undefined;
  return {
    version: 1,
    savedAt: typeof savedAt?.value === "string" ? savedAt.value : new Date().toISOString(),
    teams: loadJsonRows(db, "relay_teams", "id"),
    rooms: loadJsonRows(db, "relay_rooms", "id"),
    invites: loadJsonRows(db, "relay_invites", "id"),
    devices: loadJsonRows(db, "relay_devices", "key"),
    keyPackages: loadJsonRows(db, "relay_key_packages", "id"),
    inviteRequests: loadJsonRows(db, "relay_invite_requests", "id"),
    inviteResponses: loadJsonRows(db, "relay_invite_responses", "id"),
    inviteAckReceipts: loadJsonRows(db, "relay_invite_ack_receipts", "id"),
    acceptedMessageReceipts: loadJsonRows(db, "relay_accepted_message_receipts", "id"),
    teamMembers: loadJsonRows(db, "relay_team_members", "team_id"),
    authSessions: loadJsonRows(db, "relay_auth_sessions", "session_id"),
    attachmentBlobs: loadJsonRows(db, "relay_attachment_blobs", "id"),
    mlsBacklog: loadMlsBacklogRows(db)
  };
}

function saveNormalizedRelayState(db: Database.Database, state: unknown, legacyJsonImportedFrom?: string) {
  if (!isRecord(state) || Array.isArray(state)) {
    throw new Error("Cannot persist malformed relay state.");
  }
  const savedAt = typeof state.savedAt === "string" ? state.savedAt : new Date().toISOString();
  db.transaction(() => {
    clearNormalizedRelayTables(db);
    db.prepare("insert into relay_meta (key, value) values (?, ?)").run("version", String(state.version ?? 1));
    db.prepare("insert into relay_meta (key, value) values (?, ?)").run("savedAt", savedAt);
    if (legacyJsonImportedFrom) {
      db.prepare("insert into relay_meta (key, value) values (?, ?)").run(
        "legacyJsonImportedFrom",
        legacyJsonImportedFrom
      );
    }
    saveJsonRows(db, "relay_teams", "id", state.teams, (item) => relayId(item, "id"));
    saveJsonRows(db, "relay_rooms", "id", state.rooms, (item) => relayId(item, "id"));
    if (Array.isArray(state.rooms)) {
      const upsertEpoch = db.prepare(
        "insert into relay_room_epochs (room_key, accepted_epoch) values (?, ?) on conflict(room_key) do update set accepted_epoch=excluded.accepted_epoch"
      );
      for (const room of state.rooms)
        if (isRecord(room) && typeof room.teamId === "string" && typeof room.id === "string")
          upsertEpoch.run(
            `${room.teamId}:${room.id}`,
            typeof room.acceptedMlsEpoch === "number" ? room.acceptedMlsEpoch : 0
          );
    }
    saveJsonRows(db, "relay_invites", "id", state.invites, (item) => relayId(item, "id"));
    saveJsonRows(db, "relay_devices", "key", state.devices, (item) => {
      const userId = relayId(item, "userId");
      const deviceId = relayId(item, "deviceId");
      return userId && deviceId ? `${userId}:${deviceId}` : null;
    });
    saveJsonRows(db, "relay_key_packages", "id", state.keyPackages, (item) => relayId(item, "id"));
    saveJsonRows(db, "relay_invite_requests", "id", state.inviteRequests, (item) => relayId(item, "requestId"));
    saveJsonRows(db, "relay_invite_responses", "id", state.inviteResponses, (item) => relayId(item, "requestId"));
    saveJsonRows(db, "relay_invite_ack_receipts", "id", state.inviteAckReceipts, (item) => relayId(item, "requestId"));
    saveJsonRows(db, "relay_accepted_message_receipts", "id", state.acceptedMessageReceipts, (item) => {
      if (!isRecord(item) || typeof item.roomKey !== "string") return null;
      const messageId = relayId(item, "messageId");
      return messageId ? JSON.stringify([item.roomKey, messageId]) : null;
    });
    saveJsonRows(db, "relay_team_members", "team_id", state.teamMembers, (item) => relayId(item, "teamId"));
    saveJsonRows(db, "relay_auth_sessions", "session_id", state.authSessions, (item) => relayId(item, "sessionId"));
    saveJsonRows(db, "relay_attachment_blobs", "id", state.attachmentBlobs, (item) => relayId(item, "id"));
    pruneMlsMessageRows(db, state.mlsBacklog);
  })();
}

function clearNormalizedRelayTables(db: Database.Database) {
  for (const table of [
    "relay_meta",
    "relay_teams",
    "relay_rooms",
    "relay_invites",
    "relay_devices",
    "relay_key_packages",
    "relay_invite_requests",
    "relay_invite_responses",
    "relay_invite_ack_receipts",
    "relay_accepted_message_receipts",
    "relay_team_members",
    "relay_auth_sessions",
    "relay_attachment_blobs"
  ]) {
    db.prepare(`delete from ${table}`).run();
  }
}

function loadMlsBacklogRows(db: Database.Database): unknown[] {
  const rows = db
    .prepare("select room_key, data_json from relay_mls_messages order by room_key, sort_order, message_id")
    .all() as Array<{ room_key?: unknown; data_json?: unknown }>;

  const backlog = new Map<string, unknown[]>();
  for (const row of rows) {
    if (typeof row.room_key !== "string" || typeof row.data_json !== "string") continue;
    try {
      const messages = backlog.get(row.room_key) ?? [];
      messages.push(JSON.parse(row.data_json) as unknown);
      backlog.set(row.room_key, messages);
    } catch {
      // The store codec validates each envelope; skip a malformed row so one
      // damaged envelope cannot hide the rest of the room backlog.
    }
  }
  return Array.from(backlog.entries()).map(([key, messages]) => ({ key, messages }));
}

function saveMlsBacklogRows(db: Database.Database, roomKey: RoomKey, messages: MlsRelayMessage[]) {
  db.transaction(() => {
    if (messages.length === 0) {
      db.prepare("delete from relay_mls_messages where room_key = ?").run(roomKey);
      return;
    }
    const messageIds = new Set(messages.map((message) => message.id));
    const existing = db.prepare("select message_id from relay_mls_messages where room_key = ?").all(roomKey) as Array<{
      message_id?: unknown;
    }>;
    const deleteMessage = db.prepare("delete from relay_mls_messages where room_key = ? and message_id = ?");
    for (const row of existing) {
      if (typeof row.message_id === "string" && !messageIds.has(row.message_id)) {
        deleteMessage.run(roomKey, row.message_id);
      }
    }

    const upsert = db.prepare(`
      insert into relay_mls_messages (room_key, message_id, sort_order, created_at, data_json)
      values (?, ?, ?, ?, ?)
      on conflict(room_key, message_id) do update set
        sort_order = excluded.sort_order,
        created_at = excluded.created_at,
        data_json = excluded.data_json
    `);
    for (const [index, message] of messages.entries()) {
      upsert.run(roomKey, message.id, index, message.createdAt, JSON.stringify(message));
    }
  })();
}

function pruneMlsMessageRows(db: Database.Database, mlsBacklog: unknown) {
  if (!Array.isArray(mlsBacklog)) return;
  const retainedByRoom = new Map<string, Set<string>>();
  for (const item of mlsBacklog) {
    if (!isRecord(item) || Array.isArray(item) || typeof item.key !== "string" || !Array.isArray(item.messages))
      continue;
    retainedByRoom.set(
      item.key,
      new Set(
        item.messages
          .filter((message): message is Record<string, unknown> => isRecord(message) && !Array.isArray(message))
          .map((message) => message.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
  }

  const rows = db.prepare("select room_key, message_id from relay_mls_messages").all() as Array<{
    room_key?: unknown;
    message_id?: unknown;
  }>;
  const deleteMessage = db.prepare("delete from relay_mls_messages where room_key = ? and message_id = ?");
  for (const row of rows) {
    if (typeof row.room_key !== "string" || typeof row.message_id !== "string") continue;
    if (!retainedByRoom.get(row.room_key)?.has(row.message_id)) {
      deleteMessage.run(row.room_key, row.message_id);
    }
  }
}

function appendMlsBacklogRow(
  db: Database.Database,
  roomKey: RoomKey,
  message: MlsRelayMessage,
  prunedMessageIds: string[]
) {
  db.transaction(() => {
    const deleteMessage = db.prepare("delete from relay_mls_messages where room_key = ? and message_id = ?");
    for (const messageId of prunedMessageIds) {
      deleteMessage.run(roomKey, messageId);
    }

    const latest = db
      .prepare("select max(sort_order) as sort_order from relay_mls_messages where room_key = ?")
      .get(roomKey) as { sort_order?: unknown } | undefined;
    const nextSortOrder = typeof latest?.sort_order === "number" ? latest.sort_order + 1 : 0;
    db.prepare(
      `
      insert or ignore into relay_mls_messages (room_key, message_id, sort_order, created_at, data_json)
      values (?, ?, ?, ?, ?)
    `
    ).run(roomKey, message.id, nextSortOrder, message.createdAt, JSON.stringify(message));
  })();
}

function loadJsonRows(db: Database.Database, table: string, keyColumn: string): unknown[] {
  const rows = db.prepare(`select data_json from ${table} order by ${keyColumn}`).all() as Array<{
    data_json?: unknown;
  }>;
  const values: unknown[] = [];
  for (const row of rows) {
    if (typeof row.data_json !== "string") continue;
    try {
      values.push(JSON.parse(row.data_json) as unknown);
    } catch {
      // The store codec will quarantine unreadable files; skip one malformed row so a
      // One bad record cannot hide every other opaque MLS room record.
    }
  }
  return values;
}

function saveJsonRows(
  db: Database.Database,
  table: string,
  keyColumn: string,
  value: unknown,
  keyForItem: (item: Record<string, unknown>) => string | null
) {
  if (!Array.isArray(value)) return;
  const insert = db.prepare(`insert into ${table} (${keyColumn}, data_json) values (?, ?)`);
  for (const item of value) {
    if (!isRecord(item) || Array.isArray(item)) continue;
    const key = keyForItem(item);
    if (!key) continue;
    insert.run(key, JSON.stringify(item));
  }
}

function relayId(item: Record<string, unknown>, key: string): string | null {
  const value = item[key];
  return typeof value === "string" && value ? value : null;
}

async function quarantinePath(path: string, reason: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.corrupt-${reason}-${timestamp}`;
  try {
    await rename(path, backupPath);
    logRelayEvent("warn", "unreadable_store_quarantined");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logRelayEvent("error", "store_quarantine_failed");
    }
  }
}
