import assert from "node:assert/strict";
import test from "node:test";
import { Database, startRelayWithWorkspace } from "../support/relay.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRelayPersistence } from "../../src/persistence.js";
import { SqliteRelayPersistence } from "../../src/sqlite-persistence.js";

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
      Promise.resolve().then(() => first.saveMlsCommit("team:room", message("one"), [], [])),
      Promise.resolve().then(() => second.saveMlsCommit("team:room", message("two"), [], []))
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
