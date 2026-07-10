import { test } from "node:test";
import {
  Database,
  WebSocket,
  assert,
  createDebugSession,
  join,
  mkdtemp,
  onceOpen,
  readdir,
  rm,
  startRelay,
  testEnvelope,
  tmpdir,
  waitForJoined,
  waitForSqliteBacklogRows,
  waitForSqliteRows,
  writeFile
} from "../support/relay.js";

test("relay restores persisted team member roles and legacy counts", async () => {
  const relay = await startRelay(
    {},
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team-core", name: "Core Team", members: 1 }],
      rooms: [],
      invites: [],
      teamMembers: [
        {
          teamId: "team-core",
          members: [{ userId: "github:first", role: "owner", joinedAt: "2026-07-04T12:00:00.000Z" }],
          userIds: ["github:first", "github:second", "github:third"]
        }
      ],
      encryptedBacklog: []
    }
  );
  try {
    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { teams: Array<{ id: string; members: number }> };
    assert.equal(body.teams.find((team) => team.id === "team-core")?.members, 3);

    const membersResponse = await fetch(`${relay.baseUrl}/teams/team-core/members`);
    assert.equal(membersResponse.status, 200);
    const membersBody = (await membersResponse.json()) as {
      members: Array<{ userId: string; role: string }>;
    };
    assert.equal(membersBody.members.find((member) => member.userId === "github:first")?.role, "owner");
    assert.equal(membersBody.members.find((member) => member.userId === "github:second")?.role, "member");
  } finally {
    await relay.close();
  }
});

test("relay drops unsafe persisted team member ids before granting access", async () => {
  const relay = await startRelay(
    {
      MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
      MULTAIPLAYER_RELAY_SEED_DEMO: "false"
    },
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team-core", name: "Core Team", members: 1 }],
      rooms: [],
      invites: [],
      teamMembers: [
        {
          teamId: "team-core",
          members: [
            { userId: "github:valid", role: "owner", joinedAt: "2026-07-04T12:00:00.000Z" },
            { userId: "github:bad\nmember", role: "admin", joinedAt: "2026-07-04T12:00:00.000Z" },
            { userId: `github:${"x".repeat(200)}`, role: "member", joinedAt: "2026-07-04T12:00:00.000Z" }
          ],
          userIds: ["github:legacy", "github:legacy\nbad", `github:${"y".repeat(200)}`]
        }
      ],
      encryptedBacklog: []
    }
  );
  const validCookie = await createDebugSession(relay.baseUrl, "github:valid", "valid");
  const legacyCookie = await createDebugSession(relay.baseUrl, "github:legacy", "legacy");
  const outsiderCookie = await createDebugSession(relay.baseUrl, "github:outsider", "outsider");
  try {
    const membersResponse = await fetch(`${relay.baseUrl}/teams/team-core/members`, {
      headers: { cookie: validCookie }
    });
    assert.equal(membersResponse.status, 200);
    const membersBody = (await membersResponse.json()) as {
      members: Array<{ userId: string; role: string }>;
    };
    assert.deepEqual(membersBody.members.map((member) => member.userId).sort(), ["github:legacy", "github:valid"]);

    const legacyWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: legacyCookie }
    });
    assert.equal(legacyWorkspace.status, 200);
    const legacyBody = (await legacyWorkspace.json()) as { teams: Array<{ id: string }> };
    assert.deepEqual(
      legacyBody.teams.map((team) => team.id),
      ["team-core"]
    );

    const outsiderWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: outsiderCookie }
    });
    assert.equal(outsiderWorkspace.status, 200);
    assert.deepEqual(await outsiderWorkspace.json(), { teams: [], rooms: [] });
  } finally {
    await relay.close();
  }
});

test("relay drops invalid persisted team and room identifiers", async () => {
  const relay = await startRelay(
    { MULTAIPLAYER_RELAY_SEED_DEMO: "false" },
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [
        { id: "team-core", name: "Core Team", members: 1 },
        { id: "team:bad", name: "Bad Team", members: 1 },
        { id: " team-padded", name: "Padded Team", members: 1 }
      ],
      rooms: [
        {
          id: "room-desktop",
          teamId: "team-core",
          name: "Desktop client",
          projectPath: "/tmp/multaiplayer",
          host: "Maddie",
          hostUserId: "github:maddiedreese",
          hostStatus: "active",
          approvalPolicy: "ask_every_turn",
          mode: { chat: true, code: true, workspace: true, browser: false },
          codexModel: "gpt-5.4",
          browserAllowedOrigins: ["https://github.com"],
          browserProfilePersistent: true,
          unread: 1
        },
        {
          id: "room:bad",
          teamId: "team-core",
          name: "Bad room",
          projectPath: "/tmp/multaiplayer",
          host: "No host",
          hostStatus: "offline",
          approvalPolicy: "ask_every_turn",
          mode: { chat: true, code: true, workspace: true, browser: false },
          codexModel: "gpt-5.4",
          browserAllowedOrigins: ["https://github.com"],
          browserProfilePersistent: true,
          unread: 0
        },
        {
          id: "room-orphan",
          teamId: "team-missing",
          name: "Orphan room",
          projectPath: "/tmp/multaiplayer",
          host: "No host",
          hostStatus: "offline",
          approvalPolicy: "ask_every_turn",
          mode: { chat: true, code: true, workspace: true, browser: false },
          codexModel: "gpt-5.4",
          browserAllowedOrigins: ["https://github.com"],
          browserProfilePersistent: true,
          unread: 0
        }
      ],
      invites: [],
      teamMembers: [
        { teamId: "team-core", userIds: ["github:first"] },
        { teamId: "team:bad", userIds: ["github:bad"] }
      ],
      encryptedBacklog: []
    }
  );
  try {
    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      teams: Array<{ id: string }>;
      rooms: Array<{
        id: string;
        teamId: string;
        codexModelPolicy?: string;
        codexReasoningEffortPolicy?: string;
        codexServiceTierPolicy?: string;
      }>;
    };
    assert.deepEqual(
      body.teams.map((team) => team.id),
      ["team-core"]
    );
    assert.deepEqual(
      body.rooms.map((room) => room.id),
      ["room-desktop"]
    );
    assert.equal(body.rooms[0]?.codexModelPolicy, "pinned");
    assert.equal(body.rooms[0]?.codexReasoningEffortPolicy, "pinned");
    assert.equal(body.rooms[0]?.codexServiceTierPolicy, "pinned");
    assert.equal(body.rooms[0]?.teamId, "team-core");
  } finally {
    await relay.close();
  }
});

test("relay salvages valid persisted records from malformed collection fields", async () => {
  const relay = await startRelay(
    {
      MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
      MULTAIPLAYER_RELAY_SEED_DEMO: "false"
    },
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team-core", name: "Core Team", members: 0 }],
      rooms: "not-an-array",
      invites: null,
      devices: { malformed: true },
      teamMembers: [
        null,
        "not-a-member-record",
        {
          teamId: "team-core",
          members: [
            null,
            { userId: "github:owner", role: "owner", joinedAt: "2026-07-04T12:00:00.000Z" },
            { userId: "github:bad\nmember", role: "admin", joinedAt: "2026-07-04T12:00:00.000Z" }
          ],
          userIds: "github:not-an-array"
        }
      ],
      authSessions: "not-an-array",
      attachmentBlobs: false,
      encryptedBacklog: { malformed: true }
    }
  );
  const ownerCookie = await createDebugSession(relay.baseUrl, "github:owner", "owner");
  const outsiderCookie = await createDebugSession(relay.baseUrl, "github:outsider", "outsider");
  try {
    const ownerWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: ownerCookie }
    });
    assert.equal(ownerWorkspace.status, 200);
    const ownerBody = (await ownerWorkspace.json()) as {
      teams: Array<{ id: string; members: number; role: string }>;
      rooms: unknown[];
    };
    assert.deepEqual(ownerBody.teams, [{ id: "team-core", name: "Core Team", members: 1, role: "owner" }]);
    assert.deepEqual(ownerBody.rooms, []);

    const outsiderWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: outsiderCookie }
    });
    assert.equal(outsiderWorkspace.status, 200);
    assert.deepEqual(await outsiderWorkspace.json(), { teams: [], rooms: [] });
  } finally {
    await relay.close();
  }
});

test("relay quarantines unreadable persisted stores", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-relay-corrupt-store-"));
  const dataPath = join(tempDir, "relay-store.json");
  await writeFile(dataPath, "{ not json", "utf8");
  const relay = await startRelay({ MULTAIPLAYER_RELAY_SEED_DEMO: "false" }, undefined, dataPath);
  try {
    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { teams: unknown[]; rooms: unknown[] };
    assert.deepEqual(body.teams, []);
    assert.deepEqual(body.rooms, []);
    const files = await readdir(tempDir);
    assert.ok(files.some((file) => /^relay-store\.json\.corrupt-unreadable-/.test(file)));
  } finally {
    await relay.close();
  }
});

test("relay quarantines unsupported persisted store versions", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-relay-unsupported-store-"));
  const dataPath = join(tempDir, "relay-store.json");
  await writeFile(
    dataPath,
    `${JSON.stringify({ version: 99, teams: [], rooms: [], invites: [], encryptedBacklog: [] })}\n`,
    "utf8"
  );
  const relay = await startRelay({ MULTAIPLAYER_RELAY_SEED_DEMO: "false" }, undefined, dataPath);
  try {
    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { teams: unknown[]; rooms: unknown[] };
    assert.deepEqual(body.teams, []);
    assert.deepEqual(body.rooms, []);
    const files = await readdir(tempDir);
    assert.ok(files.some((file) => /^relay-store\.json\.corrupt-unsupported-version-/.test(file)));
  } finally {
    await relay.close();
  }
});

test("relay persists workspace state through SQLite storage", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-relay-sqlite-store-"));
  const dataPath = join(tempDir, "relay-store.sqlite");
  const relay = await startRelay(
    {
      MULTAIPLAYER_RELAY_STORAGE: "sqlite",
      MULTAIPLAYER_RELAY_SEED_DEMO: "false"
    },
    undefined,
    dataPath
  );
  let restarted: RelayHarness | null = null;
  try {
    const createTeam = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "SQLite Team", requesterUserId: "github:owner" })
    });
    assert.equal(createTeam.status, 201);
    const team = (await createTeam.json()) as { team: { id: string } };

    const createRoom = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: team.team.id,
        name: "SQLite Room",
        projectPath: "/tmp/multaiplayer",
        requesterUserId: "github:owner"
      })
    });
    assert.equal(createRoom.status, 201);

    await waitForSqliteRows(dataPath, ({ teams, rooms, snapshots }) => {
      return (
        teams.some((item) => JSON.parse(item.data_json).name === "SQLite Team") &&
        rooms.some((item) => JSON.parse(item.data_json).name === "SQLite Room") &&
        snapshots.length === 0
      );
    });

    await relay.close({ preserveData: true });

    restarted = await startRelay(
      {
        MULTAIPLAYER_RELAY_STORAGE: "sqlite",
        MULTAIPLAYER_RELAY_SEED_DEMO: "false"
      },
      undefined,
      dataPath
    );
    const response = await fetch(`${restarted.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      teams: Array<{ name: string }>;
      rooms: Array<{ name: string }>;
    };
    assert.ok(body.teams.some((item) => item.name === "SQLite Team"));
    assert.ok(body.rooms.some((item) => item.name === "SQLite Room"));
  } finally {
    if (restarted) await restarted.close();
    else await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("relay persists SQLite encrypted backlog as individual envelope rows", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-relay-sqlite-backlog-"));
  const dataPath = join(tempDir, "relay-store.sqlite");
  const relay = await startRelay(
    {
      MULTAIPLAYER_RELAY_STORAGE: "sqlite",
      MULTAIPLAYER_RELAY_BACKLOG_LIMIT: "1"
    },
    undefined,
    dataPath
  );
  const sender = new WebSocket(relay.wsUrl);
  try {
    await onceOpen(sender);
    sender.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );
    await waitForJoined(sender);

    sender.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({ id: "sqlite-backlog-first", createdAt: "2026-07-07T00:00:02.000Z" })
      })
    );
    await waitForSqliteBacklogRows(
      dataPath,
      (rows) => rows.length === 1 && rows[0]?.envelope_id === "sqlite-backlog-first"
    );

    sender.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({ id: "sqlite-backlog-second", createdAt: "2026-07-07T00:00:01.000Z" })
      })
    );

    const rows = await waitForSqliteBacklogRows(
      dataPath,
      (currentRows) =>
        currentRows.length === 1 &&
        currentRows[0]?.envelope_id === "sqlite-backlog-second" &&
        currentRows[0]?.sort_order === 0
    );
    assert.equal(JSON.parse(rows[0]?.data_json ?? "{}").id, "sqlite-backlog-second");

    const db = new Database(dataPath, { readonly: true });
    try {
      const legacyRows = db.prepare("select data_json from relay_encrypted_backlog").all() as Array<{
        data_json: string;
      }>;
      assert.deepEqual(legacyRows, []);
    } finally {
      db.close();
    }
  } finally {
    sender.close();
    await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("relay appends SQLite encrypted backlog rows without rewriting retained rows", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-relay-sqlite-backlog-delta-"));
  const dataPath = join(tempDir, "relay-store.sqlite");
  const relay = await startRelay(
    {
      MULTAIPLAYER_RELAY_STORAGE: "sqlite",
      MULTAIPLAYER_RELAY_BACKLOG_LIMIT: "2"
    },
    undefined,
    dataPath
  );
  const sender = new WebSocket(relay.wsUrl);
  try {
    await onceOpen(sender);
    sender.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );
    await waitForJoined(sender);

    for (const id of ["sqlite-delta-first", "sqlite-delta-second"]) {
      sender.send(
        JSON.stringify({
          type: "publish",
          envelope: testEnvelope({ id, createdAt: `2026-07-07T00:00:0${id.endsWith("first") ? "1" : "2"}.000Z` })
        })
      );
    }
    const initialRows = await waitForSqliteBacklogRows(dataPath, (rows) => rows.length === 2);
    const retainedBeforeAppend = initialRows.find((row) => row.envelope_id === "sqlite-delta-second");
    assert.ok(retainedBeforeAppend);

    sender.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({ id: "sqlite-delta-third", createdAt: "2026-07-07T00:00:03.000Z" })
      })
    );

    const rows = await waitForSqliteBacklogRows(dataPath, (currentRows) => {
      const ids = currentRows.map((row) => row.envelope_id);
      return (
        currentRows.length === 2 &&
        !ids.includes("sqlite-delta-first") &&
        ids.includes("sqlite-delta-second") &&
        ids.includes("sqlite-delta-third")
      );
    });
    assert.deepEqual(
      rows.map((row) => JSON.parse(row.data_json).id),
      ["sqlite-delta-second", "sqlite-delta-third"]
    );
    assert.equal(rows.find((row) => row.envelope_id === "sqlite-delta-second")?.rowid, retainedBeforeAppend.rowid);
  } finally {
    sender.close();
    await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("relay prunes stale SQLite encrypted envelope rows on generic save", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-relay-sqlite-backlog-prune-"));
  const dataPath = join(tempDir, "relay-store.sqlite");
  const relay = await startRelay(
    {
      MULTAIPLAYER_RELAY_STORAGE: "sqlite",
      MULTAIPLAYER_RELAY_BACKLOG_RETENTION_DAYS: "365"
    },
    undefined,
    dataPath
  );
  const sender = new WebSocket(relay.wsUrl);
  let restarted: RelayHarness | null = null;
  try {
    await onceOpen(sender);
    sender.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );
    await waitForJoined(sender);

    sender.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({ id: "sqlite-stale-envelope", createdAt: "2026-07-05T00:00:00.000Z" })
      })
    );
    await waitForSqliteBacklogRows(
      dataPath,
      (rows) => rows.length === 1 && rows[0]?.envelope_id === "sqlite-stale-envelope"
    );
    sender.close();
    await relay.close({ preserveData: true });

    restarted = await startRelay(
      {
        MULTAIPLAYER_RELAY_STORAGE: "sqlite",
        MULTAIPLAYER_RELAY_BACKLOG_RETENTION_DAYS: "1"
      },
      undefined,
      dataPath
    );
    await restarted.close({ preserveData: true });

    const db = new Database(dataPath, { readonly: true });
    try {
      const rows = db
        .prepare("select envelope_id from relay_encrypted_envelopes where room_key = ?")
        .all("team-core:room-desktop");
      assert.deepEqual(rows, []);
    } finally {
      db.close();
    }
  } finally {
    sender.close();
    if (restarted) await restarted.close();
    else await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
