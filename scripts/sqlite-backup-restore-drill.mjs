import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const args = new Set(process.argv.slice(2));
const fixtureMode = args.has("--fixture");
const dataPathArg = process.argv.find((arg) => arg.startsWith("--data-path="));
const dataPath = dataPathArg?.slice("--data-path=".length) ?? process.env.MULTAIPLAYER_RELAY_DATA_PATH;

let tempDir = null;
let sourcePath = dataPath;

try {
  if (fixtureMode) {
    tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-sqlite-drill-"));
    sourcePath = join(tempDir, "relay-store.sqlite");
    createFixtureRelayStore(sourcePath);
  }
  if (!sourcePath) {
    throw new Error(
      "Set MULTAIPLAYER_RELAY_DATA_PATH, pass --data-path=/path/to/relay-store.sqlite, or use --fixture."
    );
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`Relay SQLite store does not exist: ${sourcePath}`);
  }

  const backupPath = join(
    tempDir ?? (await mkdtemp(join(tmpdir(), "multaiplayer-sqlite-drill-"))),
    "relay-store.backup.sqlite"
  );
  const source = new Database(sourcePath, { readonly: true });
  assertIntegrity(source, "source");
  await source.backup(backupPath);
  source.close();

  const restored = new Database(backupPath, { readonly: true });
  assertIntegrity(restored, "backup");
  assertRelayTables(restored);
  restored.close();

  console.log(`SQLite backup/restore drill passed: ${sourcePath} -> ${backupPath}`);
} finally {
  if (fixtureMode && tempDir) await rm(tempDir, { recursive: true, force: true });
}

function createFixtureRelayStore(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    create table relay_meta (key text primary key, value text not null);
    create table relay_teams (id text primary key, data_json text not null);
    create table relay_rooms (id text primary key, data_json text not null);
    create table relay_invites (id text primary key, data_json text not null);
    create table relay_devices (key text primary key, data_json text not null);
    create table relay_team_members (team_id text primary key, data_json text not null);
    create table relay_auth_sessions (session_id text primary key, data_json text not null);
    create table relay_attachment_blobs (id text primary key, data_json text not null);
    create table relay_encrypted_backlog (room_key text primary key, data_json text not null);
    create table relay_encrypted_envelopes (
      room_key text not null,
      envelope_id text not null,
      sort_order integer not null,
      created_at text not null,
      data_json text not null,
      primary key (room_key, envelope_id)
    );
  `);
  db.prepare("insert into relay_meta (key, value) values (?, ?)").run("version", "1");
  db.prepare("insert into relay_meta (key, value) values (?, ?)").run("savedAt", "2026-07-08T00:00:00.000Z");
  db.prepare("insert into relay_teams (id, data_json) values (?, ?)").run(
    "team-alpha",
    JSON.stringify({ id: "team-alpha", name: "Alpha" })
  );
  db.prepare("insert into relay_rooms (id, data_json) values (?, ?)").run(
    "room-alpha",
    JSON.stringify({ id: "room-alpha", teamId: "team-alpha", name: "Alpha" })
  );
  db.prepare("insert into relay_team_members (team_id, data_json) values (?, ?)").run(
    "team-alpha",
    JSON.stringify({ teamId: "team-alpha", members: [] })
  );
  db.prepare(
    "insert into relay_encrypted_envelopes (room_key, envelope_id, sort_order, created_at, data_json) values (?, ?, ?, ?, ?)"
  ).run(
    "team-alpha:room-alpha",
    "env-alpha",
    0,
    "2026-07-08T00:00:00.000Z",
    JSON.stringify({ id: "env-alpha", kind: "chat.message" })
  );
  db.close();
}

function assertIntegrity(db, label) {
  const result = db.prepare("pragma integrity_check").pluck().get();
  if (result !== "ok") throw new Error(`${label} integrity_check failed: ${String(result)}`);
}

function assertRelayTables(db) {
  const tables = new Set(db.prepare("select name from sqlite_master where type = 'table'").pluck().all());
  for (const table of ["relay_meta", "relay_teams", "relay_rooms", "relay_team_members", "relay_encrypted_envelopes"]) {
    if (!tables.has(table)) throw new Error(`backup is missing relay table ${table}`);
  }
  const version = db.prepare("select value from relay_meta where key = ?").pluck().get("version");
  if (version !== "1") throw new Error(`backup has unexpected relay store version: ${String(version)}`);
}
