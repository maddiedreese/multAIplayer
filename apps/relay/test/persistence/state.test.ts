import assert from "node:assert/strict";
import test from "node:test";
import { Database, startRelay, startRelayWithWorkspace } from "../support/relay.js";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRelayPersistence } from "../../src/persistence.js";
import { RelayPersistenceMigrationError, SqliteRelayPersistence } from "../../src/sqlite-persistence.js";

test("SQLite initializes normalized MLS and KeyPackage tables", async () => {
  const relay = await startRelayWithWorkspace({ MULTAIPLAYER_RELAY_STORAGE: "sqlite" });
  try {
    await relay.close({ preserveData: true });
    const db = new Database(relay.dataPath, { readonly: true });
    const tables = new Set(
      (db.prepare("select name from sqlite_master where type='table'").all() as Array<{ name: string }>).map(
        (x) => x.name
      )
    );
    for (const table of [
      "relay_mls_messages",
      "relay_room_epochs",
      "relay_key_packages",
      "relay_invite_requests",
      "relay_invite_responses",
      "relay_invite_ack_receipts",
      "relay_accepted_message_receipts"
    ])
      assert.ok(tables.has(table));
    db.close();
  } finally {
    await relay.close();
  }
});

test("SQLite refuses existing state with missing or unsupported version metadata", async () => {
  for (const version of [null, "2"] as const) {
    const dir = await mkdtemp(join(tmpdir(), "relay-version-metadata-"));
    const path = join(dir, "relay.sqlite");
    const persistence = new SqliteRelayPersistence(path);
    await persistence.save({
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team", name: "Team", members: 0 }],
      rooms: [],
      invites: [],
      mlsBacklog: []
    });
    persistence.close();
    const db = new Database(path);
    if (version === null) db.prepare("delete from relay_meta where key = 'version'").run();
    else db.prepare("update relay_meta set value = ? where key = 'version'").run(version);
    db.close();
    const reopened = new SqliteRelayPersistence(path);
    try {
      await assert.rejects(reopened.load(), /missing or unsupported version metadata/);
    } finally {
      reopened.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("SQLite refuses malformed JSON rows and storage-key identity mismatches", async () => {
  for (const data of ["{not-json", JSON.stringify({ id: "different-team", name: "Team", members: 0 })]) {
    const dir = await mkdtemp(join(tmpdir(), "relay-invalid-row-"));
    const path = join(dir, "relay.sqlite");
    const persistence = new SqliteRelayPersistence(path);
    await persistence.save({
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team", name: "Team", members: 0 }],
      rooms: [],
      invites: [],
      mlsBacklog: []
    });
    persistence.close();
    const db = new Database(path);
    db.prepare("update relay_teams set data_json = ? where id = 'team'").run(data);
    db.close();
    const reopened = new SqliteRelayPersistence(path);
    try {
      await assert.rejects(reopened.load(), /malformed JSON or a mismatched row identity/);
    } finally {
      reopened.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("SQLite refuses malformed or identity-mismatched MLS backlog rows", async () => {
  for (const data of [
    "{not-json",
    JSON.stringify({
      id: "different-message",
      teamId: "team",
      roomId: "room",
      senderUserId: "user",
      senderDeviceId: "device",
      createdAt: new Date().toISOString(),
      messageType: "application",
      epochHint: 0,
      mlsMessage: "AA=="
    })
  ]) {
    const dir = await mkdtemp(join(tmpdir(), "relay-invalid-mls-row-"));
    const path = join(dir, "relay.sqlite");
    const persistence = new SqliteRelayPersistence(path);
    await persistence.save({
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [],
      rooms: [],
      invites: [],
      mlsBacklog: [
        {
          key: "team:room",
          messages: [
            {
              id: "message",
              teamId: "team",
              roomId: "room",
              senderUserId: "user",
              senderDeviceId: "device",
              createdAt: new Date().toISOString(),
              messageType: "application",
              epochHint: 0,
              mlsMessage: "AA=="
            }
          ]
        }
      ]
    });
    persistence.close();
    const db = new Database(path);
    db.prepare(
      "insert into relay_mls_messages (room_key, message_id, sort_order, created_at, data_json) values (?, ?, ?, ?, ?)"
    ).run("team:room", "message", 0, new Date().toISOString(), data);
    db.close();
    const reopened = new SqliteRelayPersistence(path);
    try {
      await assert.rejects(reopened.load(), /MLS backlog contains malformed JSON or a mismatched row identity/);
    } finally {
      reopened.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("SQLite startup purges legacy host-local room config from rows, pages, and WAL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-room-config-purge-"));
  const path = join(dir, "relay.sqlite");
  const marker = "/Users/sentinel/PROJECT-PATH-MUST-NEVER-REACH-RELAY";
  const legacy = new SqliteRelayPersistence(path);
  const publicRoom = { id: "room", teamId: "team", name: "Room", host: "Host", hostStatus: "offline" };
  await legacy.save({
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [],
    rooms: [{ ...publicRoom, projectPath: marker, codexModel: "sentinel-model" }],
    invites: [],
    mlsBacklog: []
  });
  legacy.close();
  const reopened = new SqliteRelayPersistence(path);
  try {
    await reopened.load();
    await reopened.finalizeLoad(() => ({
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [],
      rooms: [publicRoom],
      invites: [],
      mlsBacklog: []
    }));
    reopened.close();
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      const bytes = await readFile(candidate).catch(() => Buffer.alloc(0));
      assert.equal(bytes.includes(Buffer.from(marker)), false, candidate);
      assert.equal(bytes.includes(Buffer.from("sentinel-model")), false, candidate);
    }
  } finally {
    reopened.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("SQLite accepts only one concurrent Commit for an epoch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-cas-")),
    path = join(dir, "relay.sqlite");
  const first = createRelayPersistence({ dataPath: path }),
    second = createRelayPersistence({ dataPath: path });
  const room = { id: "room", teamId: "team", acceptedMlsEpoch: 0 };
  const state = {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [],
    rooms: [room],
    invites: [],
    mlsBacklog: []
  };
  await first.save(state);
  const message = (id: string) => ({
    id,
    teamId: "team",
    roomId: "room",
    senderUserId: "user",
    senderDeviceId: "device-1",
    createdAt: new Date().toISOString(),
    messageType: "commit" as const,
    epochHint: 0,
    mlsMessage: "AA=="
  });
  try {
    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        first.saveMlsCommit("team:room", message("one"), [], [], () => ({
          ...state,
          rooms: [{ ...room, acceptedMlsEpoch: 1 }]
        }))
      ),
      Promise.resolve().then(() =>
        second.saveMlsCommit("team:room", message("two"), [], [], () => ({
          ...state,
          rooms: [{ ...room, acceptedMlsEpoch: 1 }]
        }))
      )
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(results.filter((x) => x.status === "rejected").length, 1);
  } finally {
    first.close();
    second.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("KeyPackage approval and pending request state survive restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-kp-restart-")),
    path = join(dir, "relay.sqlite");
  const persistence = createRelayPersistence({ dataPath: path });
  const state = {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [],
    rooms: [],
    invites: [
      {
        id: "invite",
        teamId: "team",
        roomId: "room",
        approvedUserId: "user",
        approvedDeviceId: "device-1",
        keyPackageHash: `sha256:${"a".repeat(64)}`,
        createdAt: new Date().toISOString()
      }
    ],
    keyPackages: [],
    inviteRequests: [
      {
        requestId: "request",
        inviteId: "invite",
        requesterUserId: "user",
        requesterDeviceId: "device-1",
        keyPackageId: "kp",
        keyPackageHash: `sha256:${"a".repeat(64)}`,
        sealedRequest: "AA==",
        createdAt: new Date().toISOString()
      }
    ],
    inviteResponses: [],
    mlsBacklog: []
  };
  try {
    await persistence.save(state);
    persistence.close();
    const reopened = createRelayPersistence({ dataPath: path });
    const loaded = (await reopened.load()) as typeof state;
    assert.equal(loaded.inviteRequests.length, 1);
    assert.equal(loaded.invites[0]?.keyPackageHash, state.invites[0]!.keyPackageHash);
    reopened.close();
  } finally {
    persistence.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy JSON imports into SQLite, accepts incremental mutations, and survives restart", async () => {
  let relay = await startRelayWithWorkspace({ MULTAIPLAYER_RELAY_STORAGE: "sqlite" });
  const dataPath = relay.dataPath;
  const tempDir = relay.tempDir;
  try {
    const created = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Created after import" })
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { team: { id: string } };

    await relay.close({ preserveData: true });
    const filesAfterImport = await readdir(tempDir);
    assert.ok(filesAfterImport.some((name) => name.startsWith("initial-relay-state.json.migrated-to-sqlite")));

    relay = await startRelay({ MULTAIPLAYER_RELAY_STORAGE: "sqlite" }, undefined, dataPath);
    const workspace = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(workspace.status, 200);
    const body = (await workspace.json()) as { teams: Array<{ id: string }>; rooms: Array<{ id: string }> };
    assert.ok(body.teams.some((team) => team.id === "team-core"));
    assert.ok(body.teams.some((team) => team.id === createdBody.team.id));
    assert.ok(body.rooms.some((room) => room.id === "room-desktop"));

    const db = new Database(dataPath, { readonly: true });
    assert.equal((db.prepare("select count(*) as count from relay_snapshots").get() as { count: number }).count, 0);
    db.close();
  } finally {
    await relay.close().catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("a post-import backup rename failure preserves committed SQLite state and retries safely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-import-rename-failure-"));
  const legacyPath = join(dir, "relay-store.json");
  const sqlitePath = join(dir, "relay-store.sqlite");
  const state = {
    version: 1 as const,
    savedAt: new Date().toISOString(),
    teams: [{ id: "team-imported", name: "Imported", members: 0 }],
    rooms: [],
    invites: [],
    mlsBacklog: []
  };
  await writeFile(legacyPath, JSON.stringify(state), "utf8");
  const persistence = new SqliteRelayPersistence(sqlitePath, legacyPath, async () => {
    throw Object.assign(new Error("forced rename failure"), { code: "EACCES" });
  });
  try {
    assert.deepEqual(await persistence.load(), state);
    await assert.rejects(
      persistence.finalizeLoad(() => state),
      (error) => error instanceof RelayPersistenceMigrationError && /Could not preserve migrated/.test(error.message)
    );
    assert.ok((await readdir(dir)).includes("relay-store.json"));
    const db = new Database(sqlitePath, { readonly: true });
    assert.equal((db.prepare("select count(*) as count from relay_teams").get() as { count: number }).count, 1);
    db.close();
    persistence.close();

    const restarted = createRelayPersistence({
      dataPath: sqlitePath,
      legacyJsonImportPath: legacyPath
    });
    const loaded = (await restarted.load()) as typeof state;
    assert.equal(loaded.teams.length, 1);
    assert.equal(loaded.teams[0]?.id, "team-imported");
    assert.equal(
      (await readdir(dir)).some((name) => name.startsWith("relay-store.json.migrated-to-sqlite")),
      true
    );
    restarted.close();
  } finally {
    persistence.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid legacy JSON aborts migration without moving or replacing the source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-invalid-legacy-"));
  const legacyPath = join(dir, "relay-store.json");
  const sqlitePath = join(dir, "relay-store.sqlite");
  await writeFile(legacyPath, "{not-json", "utf8");
  const persistence = createRelayPersistence({
    dataPath: sqlitePath,
    legacyJsonImportPath: legacyPath
  });
  try {
    await assert.rejects(persistence.load(), /Could not import legacy relay store/);
    assert.ok((await readdir(dir)).includes("relay-store.json"));
    assert.equal(
      (await readdir(dir)).some((name) => name.includes("migrated-to-sqlite")),
      false
    );
  } finally {
    persistence.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("unsupported legacy JSON versions abort migration and preserve the source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-unsupported-legacy-"));
  const legacyPath = join(dir, "relay-store.json");
  const sqlitePath = join(dir, "relay-store.sqlite");
  await writeFile(legacyPath, JSON.stringify({ version: 999, teams: [] }), "utf8");
  const persistence = createRelayPersistence({
    dataPath: sqlitePath,
    legacyJsonImportPath: legacyPath
  });
  try {
    await assert.rejects(persistence.load(), /Could not import legacy relay store/);
    assert.ok((await readdir(dir)).includes("relay-store.json"));
    assert.equal(
      (await readdir(dir)).some((name) => name.includes("migrated-to-sqlite")),
      false
    );
  } finally {
    persistence.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("incremental SQLite writes never update or delete unrelated entity rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-incremental-"));
  const path = join(dir, "relay.sqlite");
  const persistence = createRelayPersistence({ dataPath: path });
  const originalTeam = { id: "team", name: "Original", members: 1 };
  try {
    await persistence.save({
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [originalTeam],
      rooms: [{ id: "room", teamId: "team", acceptedMlsEpoch: 0 }],
      invites: [],
      mlsBacklog: []
    });
    const db = new Database(path);
    db.exec(`
      create table entity_write_audit (operation text not null);
      create trigger audit_team_update after update on relay_teams begin
        insert into entity_write_audit values ('update');
      end;
      create trigger audit_team_delete after delete on relay_teams begin
        insert into entity_write_audit values ('delete');
      end;
    `);
    db.close();

    await persistence.saveChanges([
      {
        entity: "rooms",
        key: "room",
        operation: "upsert",
        value: { id: "room", teamId: "team", name: "Changed", acceptedMlsEpoch: 0 }
      }
    ]);

    const verify = new Database(path, { readonly: true });
    assert.equal(
      (verify.prepare("select count(*) as count from entity_write_audit").get() as { count: number }).count,
      0
    );
    assert.deepEqual(
      JSON.parse(
        (verify.prepare("select data_json from relay_teams where id = ?").get("team") as { data_json: string })
          .data_json
      ),
      originalTeam
    );
    assert.equal(
      JSON.parse(
        (verify.prepare("select data_json from relay_rooms where id = ?").get("room") as { data_json: string })
          .data_json
      ).name,
      "Changed"
    );
    verify.close();
  } finally {
    persistence.close();
    await rm(dir, { recursive: true, force: true });
  }
});
