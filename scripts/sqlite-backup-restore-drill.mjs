import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openRelayDatabase } from "../apps/relay/src/sqlite-schema.ts";

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
  const sourceRelayTables = relayTableNames(source);
  await source.backup(backupPath);
  source.close();

  const restored = new Database(backupPath, { readonly: true });
  assertIntegrity(restored, "backup");
  assertRelayTables(restored, sourceRelayTables);
  restored.close();

  console.log(`SQLite backup/restore drill passed: ${sourcePath} -> ${backupPath}`);
} finally {
  if (fixtureMode && tempDir) await rm(tempDir, { recursive: true, force: true });
}

function createFixtureRelayStore(path) {
  const db = openRelayDatabase(path);
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
    "insert into relay_mls_messages (room_key, message_id, sort_order, created_at, data_json) values (?, ?, ?, ?, ?)"
  ).run(
    "team-alpha:room-alpha",
    "env-alpha",
    0,
    "2026-07-08T00:00:00.000Z",
    JSON.stringify({ id: "env-alpha", kind: "chat.message" })
  );
  db.prepare("insert into relay_room_epochs (room_key, accepted_epoch) values (?, ?)").run("team-alpha:room-alpha", 0);
  db.close();
}

function assertIntegrity(db, label) {
  const result = db.prepare("pragma integrity_check").pluck().get();
  if (result !== "ok") throw new Error(`${label} integrity_check failed: ${String(result)}`);
}

function relayTableNames(db) {
  return db
    .prepare("select name from sqlite_master where type = 'table' and name like 'relay_%' order by name")
    .pluck()
    .all();
}

function assertRelayTables(db, requiredRelayTables) {
  const restoredRelayTables = relayTableNames(db);
  if (JSON.stringify(restoredRelayTables) !== JSON.stringify(requiredRelayTables)) {
    throw new Error(
      `backup relay schema differs from source: ${JSON.stringify({ source: requiredRelayTables, backup: restoredRelayTables })}`
    );
  }
  const tables = new Set(restoredRelayTables);
  for (const table of requiredRelayTables) {
    if (!tables.has(table)) throw new Error(`backup is missing relay table ${table}`);
  }
  const version = db.prepare("select value from relay_meta where key = ?").pluck().get("version");
  if (version === "1") return;
  const storedRows = requiredRelayTables
    .filter((table) => table !== "relay_meta")
    .reduce((total, table) => total + Number(db.prepare(`select count(*) from ${table}`).pluck().get()), 0);
  if (version === undefined && storedRows === 0) return;
  throw new Error(`backup has unexpected relay store version: ${String(version)}`);
}
