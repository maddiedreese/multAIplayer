import Database from "better-sqlite3";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import { isRecord, type RelayEnvelope } from "@multaiplayer/protocol";
import type { RoomKey } from "./state.js";

export type RelayStorageBackend = "json" | "sqlite";

export interface RelayPersistence {
  readonly flushMode: "debounced" | "immediate";
  load(): Promise<unknown | null>;
  save(state: unknown): Promise<void>;
  saveEncryptedBacklog(roomKey: RoomKey, envelopes: RelayEnvelope[]): Promise<boolean>;
  saveEncryptedEnvelope(roomKey: RoomKey, envelope: RelayEnvelope, prunedEnvelopeIds: string[]): Promise<boolean>;
  quarantine(reason: string): Promise<void>;
  close(): void;
}

export function createRelayPersistence(options: { backend: RelayStorageBackend; dataPath: string }): RelayPersistence {
  return options.backend === "sqlite"
    ? new SqliteRelayPersistence(options.dataPath)
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
    await mkdir(dirname(this.dataPath), { recursive: true });
    const tempPath = `${this.dataPath}.${process.pid}.${nanoid(8)}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.dataPath);
  }

  async saveEncryptedBacklog(): Promise<boolean> {
    return false;
  }

  async saveEncryptedEnvelope(): Promise<boolean> {
    return false;
  }

  async quarantine(reason: string): Promise<void> {
    await quarantinePath(this.dataPath, reason);
  }

  close() {}
}

class SqliteRelayPersistence implements RelayPersistence {
  readonly flushMode = "debounced";
  private db: Database.Database | null = null;

  constructor(private readonly dataPath: string) {}

  async load(): Promise<unknown | null> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    const db = this.getDb();
    const normalized = loadNormalizedRelayState(db);
    if (normalized !== null) return normalized;
    const row = db.prepare("select state_json from relay_snapshots where id = ?").get("current") as
      { state_json?: unknown } | undefined;
    if (typeof row?.state_json !== "string") return null;
    return JSON.parse(row.state_json) as unknown;
  }

  async save(state: unknown): Promise<void> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    saveNormalizedRelayState(this.getDb(), state);
  }

  async saveEncryptedBacklog(roomKey: RoomKey, envelopes: RelayEnvelope[]): Promise<boolean> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    saveEncryptedBacklogRows(this.getDb(), roomKey, envelopes);
    return true;
  }

  async saveEncryptedEnvelope(
    roomKey: RoomKey,
    envelope: RelayEnvelope,
    prunedEnvelopeIds: string[]
  ): Promise<boolean> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    appendEncryptedBacklogRow(this.getDb(), roomKey, envelope, prunedEnvelopeIds);
    return true;
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
      create table if not exists relay_encrypted_backlog (
        room_key text primary key,
        data_json text not null
      );
      create table if not exists relay_encrypted_envelopes (
        room_key text not null,
        envelope_id text not null,
        sort_order integer not null,
        created_at text not null,
        data_json text not null,
        primary key (room_key, envelope_id)
      )
    `);
    migrateLegacyEncryptedBacklogRows(db);
    this.db = db;
    return db;
  }

  close() {
    this.db?.close();
    this.db = null;
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
    teamMembers: loadJsonRows(db, "relay_team_members", "team_id"),
    authSessions: loadJsonRows(db, "relay_auth_sessions", "session_id"),
    attachmentBlobs: loadJsonRows(db, "relay_attachment_blobs", "id"),
    encryptedBacklog: loadEncryptedBacklogRows(db)
  };
}

function saveNormalizedRelayState(db: Database.Database, state: unknown) {
  if (!isRecord(state) || Array.isArray(state)) {
    throw new Error("Cannot persist malformed relay state.");
  }
  const savedAt = typeof state.savedAt === "string" ? state.savedAt : new Date().toISOString();
  db.transaction(() => {
    clearNormalizedRelayTables(db);
    db.prepare("insert into relay_meta (key, value) values (?, ?)").run("version", String(state.version ?? 1));
    db.prepare("insert into relay_meta (key, value) values (?, ?)").run("savedAt", savedAt);
    saveJsonRows(db, "relay_teams", "id", state.teams, (item) => relayId(item, "id"));
    saveJsonRows(db, "relay_rooms", "id", state.rooms, (item) => relayId(item, "id"));
    saveJsonRows(db, "relay_invites", "id", state.invites, (item) => relayId(item, "id"));
    saveJsonRows(db, "relay_devices", "key", state.devices, (item) => {
      const userId = relayId(item, "userId");
      const deviceId = relayId(item, "deviceId");
      return userId && deviceId ? `${userId}:${deviceId}` : null;
    });
    saveJsonRows(db, "relay_team_members", "team_id", state.teamMembers, (item) => relayId(item, "teamId"));
    saveJsonRows(db, "relay_auth_sessions", "session_id", state.authSessions, (item) => relayId(item, "sessionId"));
    saveJsonRows(db, "relay_attachment_blobs", "id", state.attachmentBlobs, (item) => relayId(item, "id"));
    pruneEncryptedEnvelopeRows(db, state.encryptedBacklog);
  })();
}

function clearNormalizedRelayTables(db: Database.Database) {
  for (const table of [
    "relay_meta",
    "relay_teams",
    "relay_rooms",
    "relay_invites",
    "relay_devices",
    "relay_team_members",
    "relay_auth_sessions",
    "relay_attachment_blobs"
  ]) {
    db.prepare(`delete from ${table}`).run();
  }
}

function loadEncryptedBacklogRows(db: Database.Database): unknown[] {
  const rows = db
    .prepare("select room_key, data_json from relay_encrypted_envelopes order by room_key, sort_order, envelope_id")
    .all() as Array<{ room_key?: unknown; data_json?: unknown }>;
  if (rows.length === 0) return loadJsonRows(db, "relay_encrypted_backlog", "room_key");

  const backlog = new Map<string, unknown[]>();
  for (const row of rows) {
    if (typeof row.room_key !== "string" || typeof row.data_json !== "string") continue;
    try {
      const envelopes = backlog.get(row.room_key) ?? [];
      envelopes.push(JSON.parse(row.data_json) as unknown);
      backlog.set(row.room_key, envelopes);
    } catch {
      // The store codec validates each envelope; skip a malformed row so one
      // damaged envelope cannot hide the rest of the room backlog.
    }
  }
  return Array.from(backlog.entries()).map(([key, envelopes]) => ({ key, envelopes }));
}

function migrateLegacyEncryptedBacklogRows(db: Database.Database) {
  const existing = db.prepare("select count(*) as count from relay_encrypted_envelopes").get() as
    { count?: unknown } | undefined;
  if (typeof existing?.count === "number" && existing.count > 0) return;

  const legacyRows = loadJsonRows(db, "relay_encrypted_backlog", "room_key");
  if (legacyRows.length === 0) return;
  db.transaction(() => {
    for (const item of legacyRows) {
      if (!isRecord(item) || Array.isArray(item) || typeof item.key !== "string" || !Array.isArray(item.envelopes))
        continue;
      for (const [index, envelope] of item.envelopes.entries()) {
        if (
          !isRecord(envelope) ||
          Array.isArray(envelope) ||
          typeof envelope.id !== "string" ||
          typeof envelope.createdAt !== "string"
        )
          continue;
        db.prepare(
          `
          insert or ignore into relay_encrypted_envelopes (room_key, envelope_id, sort_order, created_at, data_json)
          values (?, ?, ?, ?, ?)
        `
        ).run(item.key, envelope.id, index, envelope.createdAt, JSON.stringify(envelope));
      }
    }
  })();
}

function saveEncryptedBacklogRows(db: Database.Database, roomKey: RoomKey, envelopes: RelayEnvelope[]) {
  db.transaction(() => {
    if (envelopes.length === 0) {
      db.prepare("delete from relay_encrypted_envelopes where room_key = ?").run(roomKey);
      return;
    }
    const envelopeIds = new Set(envelopes.map((envelope) => envelope.id));
    const existing = db
      .prepare("select envelope_id from relay_encrypted_envelopes where room_key = ?")
      .all(roomKey) as Array<{ envelope_id?: unknown }>;
    const deleteEnvelope = db.prepare("delete from relay_encrypted_envelopes where room_key = ? and envelope_id = ?");
    for (const row of existing) {
      if (typeof row.envelope_id === "string" && !envelopeIds.has(row.envelope_id)) {
        deleteEnvelope.run(roomKey, row.envelope_id);
      }
    }

    const upsert = db.prepare(`
      insert into relay_encrypted_envelopes (room_key, envelope_id, sort_order, created_at, data_json)
      values (?, ?, ?, ?, ?)
      on conflict(room_key, envelope_id) do update set
        sort_order = excluded.sort_order,
        created_at = excluded.created_at,
        data_json = excluded.data_json
    `);
    for (const [index, envelope] of envelopes.entries()) {
      upsert.run(roomKey, envelope.id, index, envelope.createdAt, JSON.stringify(envelope));
    }
  })();
}

function pruneEncryptedEnvelopeRows(db: Database.Database, encryptedBacklog: unknown) {
  if (!Array.isArray(encryptedBacklog)) return;
  const retainedByRoom = new Map<string, Set<string>>();
  for (const item of encryptedBacklog) {
    if (!isRecord(item) || Array.isArray(item) || typeof item.key !== "string" || !Array.isArray(item.envelopes))
      continue;
    retainedByRoom.set(
      item.key,
      new Set(
        item.envelopes
          .filter((envelope): envelope is Record<string, unknown> => isRecord(envelope) && !Array.isArray(envelope))
          .map((envelope) => envelope.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
  }

  const rows = db.prepare("select room_key, envelope_id from relay_encrypted_envelopes").all() as Array<{
    room_key?: unknown;
    envelope_id?: unknown;
  }>;
  const deleteEnvelope = db.prepare("delete from relay_encrypted_envelopes where room_key = ? and envelope_id = ?");
  for (const row of rows) {
    if (typeof row.room_key !== "string" || typeof row.envelope_id !== "string") continue;
    if (!retainedByRoom.get(row.room_key)?.has(row.envelope_id)) {
      deleteEnvelope.run(row.room_key, row.envelope_id);
    }
  }
}

function appendEncryptedBacklogRow(
  db: Database.Database,
  roomKey: RoomKey,
  envelope: RelayEnvelope,
  prunedEnvelopeIds: string[]
) {
  db.transaction(() => {
    const deleteEnvelope = db.prepare("delete from relay_encrypted_envelopes where room_key = ? and envelope_id = ?");
    for (const envelopeId of prunedEnvelopeIds) {
      deleteEnvelope.run(roomKey, envelopeId);
    }

    const latest = db
      .prepare("select max(sort_order) as sort_order from relay_encrypted_envelopes where room_key = ?")
      .get(roomKey) as { sort_order?: unknown } | undefined;
    const nextSortOrder = typeof latest?.sort_order === "number" ? latest.sort_order + 1 : 0;
    db.prepare(
      `
      insert or ignore into relay_encrypted_envelopes (room_key, envelope_id, sort_order, created_at, data_json)
      values (?, ?, ?, ?, ?)
    `
    ).run(roomKey, envelope.id, nextSortOrder, envelope.createdAt, JSON.stringify(envelope));
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
      // single bad record cannot hide every other encrypted room record.
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
    console.warn(`Moved unreadable relay store to ${backupPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to move unreadable relay store at ${path}:`, error);
    }
  }
}
