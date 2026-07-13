import assert from "node:assert/strict";
import test from "node:test";
import { Database, startRelayWithWorkspace } from "../support/relay.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRelayPersistence } from "../../src/persistence.js";

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

test("SQLite accepts only one concurrent Commit for an epoch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-cas-")),
    path = join(dir, "relay.sqlite");
  const first = createRelayPersistence({ backend: "sqlite", dataPath: path }),
    second = createRelayPersistence({ backend: "sqlite", dataPath: path });
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
      first.saveMlsCommit("team:room", message("one"), [], { ...state, rooms: [{ ...room, acceptedMlsEpoch: 1 }] }),
      second.saveMlsCommit("team:room", message("two"), [], { ...state, rooms: [{ ...room, acceptedMlsEpoch: 1 }] })
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
  const persistence = createRelayPersistence({ backend: "sqlite", dataPath: path });
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
    const reopened = createRelayPersistence({ backend: "sqlite", dataPath: path });
    const loaded = (await reopened.load()) as typeof state;
    assert.equal(loaded.inviteRequests.length, 1);
    assert.equal(loaded.invites[0]?.keyPackageHash, state.invites[0]!.keyPackageHash);
    reopened.close();
  } finally {
    persistence.close();
    await rm(dir, { recursive: true, force: true });
  }
});
