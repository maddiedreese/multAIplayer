import { test } from "node:test";
import { chmod, mkdir, stat } from "node:fs/promises";
import { assert, join, mkdtemp, rm, tmpdir } from "../support/relay.js";
import { createRelayPersistence } from "../../src/persistence.js";

test("SQLite persistence uses owner-only directory and files", async () => {
  const root = await mkdtemp(join(tmpdir(), "multaiplayer-permissions-test-"));
  const directory = join(root, "private");
  const dataPath = join(directory, "relay-store.sqlite");
  try {
    const persistence = createRelayPersistence({ dataPath });
    await persistence.save({ version: 1, teams: [], rooms: [], invites: [], mlsBacklog: [] });
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(dataPath)).mode & 0o777, 0o600);
    assert.equal((await stat(`${dataPath}-wal`)).mode & 0o777, 0o600);
    assert.equal((await stat(`${dataPath}-shm`)).mode & 0o777, 0o600);
    persistence.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistence preserves existing parent permissions while protecting store files", async () => {
  const root = await mkdtemp(join(tmpdir(), "multaiplayer-existing-parent-test-"));
  const directory = join(root, "shared");
  try {
    await mkdir(directory);
    await chmod(directory, 0o750);
    const sqlitePath = join(directory, "relay-store.sqlite");
    const sqlite = createRelayPersistence({ dataPath: sqlitePath });
    await sqlite.save({ version: 1, teams: [], rooms: [], invites: [], encryptedBacklog: [] });
    assert.equal((await stat(directory)).mode & 0o777, 0o750);
    assert.equal((await stat(sqlitePath)).mode & 0o777, 0o600);
    assert.equal((await stat(`${sqlitePath}-wal`)).mode & 0o777, 0o600);
    assert.equal((await stat(`${sqlitePath}-shm`)).mode & 0o777, 0o600);
    sqlite.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite persistence reports synchronous write durations", async () => {
  const root = await mkdtemp(join(tmpdir(), "multaiplayer-sqlite-duration-test-"));
  const durations: number[] = [];
  try {
    const persistence = createRelayPersistence({
      dataPath: join(root, "relay-store.sqlite"),
      recordSqliteWriteDuration: (duration) => durations.push(duration)
    });
    await persistence.save({ version: 1, teams: [], rooms: [], invites: [], mlsBacklog: [] });
    await persistence.saveChanges([]);
    persistence.close();
    assert.equal(durations.length, 1);
    assert.ok(durations[0]! >= 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
