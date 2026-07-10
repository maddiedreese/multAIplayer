import { test } from "node:test";
import {
  WebSocket,
  assert,
  debugBacklog,
  deviceSealedPayload,
  onceOpen,
  patchHostStatus,
  readFile,
  rm,
  startRelay,
  testEnvelope,
  waitForClose,
  waitForDebugBacklog,
  waitForEnvelope,
  waitForError,
  waitForJoined,
  waitForPresence,
  waitForRejectedOpen,
  waitForRoomUpdated,
  waitForTeamUpdated,
  writeFile,
  type StoredRelayStateFixture
} from "../support/relay.js";

test("relay rejects non-host takeover and allows explicit handoff", async () => {
  const relay = await startRelay();
  try {
    assert.equal(
      await patchHostStatus(relay.baseUrl, { host: "Peer", hostUserId: "github:peer", hostStatus: "active" }),
      409
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, { host: "Peer", hostUserId: "github:peer", hostStatus: "handoff" }),
      403
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, {
        host: "Maddie",
        hostUserId: "github:maddiedreese",
        hostStatus: "handoff"
      }),
      200
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, { host: "Peer", hostUserId: "github:peer", hostStatus: "active" }),
      200
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, {
        host: "Maddie",
        hostUserId: "github:maddiedreese",
        hostStatus: "offline"
      }),
      403
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, { host: "Peer", hostUserId: "github:peer", hostStatus: "offline" }),
      200
    );
  } finally {
    await relay.close();
  }
});

test("relay broadcasts room.updated after room settings change", async () => {
  const relay = await startRelay();
  const socket = new WebSocket(relay.wsUrl);
  try {
    await onceOpen(socket);
    socket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );

    const updatePromise = waitForRoomUpdated(socket);
    const response = await fetch(`${relay.baseUrl}/rooms/room-desktop/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        name: "Renamed desktop app",
        codexModel: "gpt-5.4-thinking",
        browserProfilePersistent: false
      })
    });
    assert.equal(response.status, 200);

    const updatedRoom = await updatePromise;
    assert.equal(updatedRoom.id, "room-desktop");
    assert.equal(updatedRoom.name, "Renamed desktop app");
    assert.equal(updatedRoom.codexModel, "gpt-5.4-thinking");
    assert.equal(updatedRoom.codexModelPolicy, "pinned");
    assert.equal(updatedRoom.browserProfilePersistent, false);
  } finally {
    socket.close();
    await relay.close();
  }
});

test("relay broadcasts newly created rooms to team subscribers", async () => {
  const relay = await startRelay();
  const socket = new WebSocket(relay.wsUrl);
  try {
    await onceOpen(socket);
    socket.send(
      JSON.stringify({
        type: "subscribe.team",
        teamId: "team-core",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );

    const updatePromise = waitForRoomUpdated(socket);
    const response = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        name: "New project room",
        projectPath: "/tmp/multaiplayer"
      })
    });
    assert.equal(response.status, 201);

    const updatedRoom = await updatePromise;
    assert.equal(updatedRoom.name, "New project room");
    assert.equal(updatedRoom.teamId, "team-core");
    assert.equal(updatedRoom.approvalPolicy, "ask_every_turn");
    assert.equal(updatedRoom.codexModelPolicy, "auto");
    assert.equal(updatedRoom.codexReasoningEffortPolicy, "auto");
    assert.equal(updatedRoom.codexServiceTierPolicy, "auto");
    assert.deepEqual(updatedRoom.browserAllowedOrigins, ["https://github.com"]);
    assert.equal(updatedRoom.browserProfilePersistent, true);
  } finally {
    socket.close();
    await relay.close();
  }
});

test("relay broadcasts newly created teams to workspace subscribers", async () => {
  const relay = await startRelay();
  const socket = new WebSocket(relay.wsUrl);
  try {
    await onceOpen(socket);
    socket.send(
      JSON.stringify({
        type: "subscribe.workspace",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );

    const updatePromise = waitForTeamUpdated(socket);
    const response = await fetch(`${relay.baseUrl}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New live team" })
    });
    assert.equal(response.status, 201);

    const updatedTeam = await updatePromise;
    assert.equal(updatedTeam.name, "New live team");
    assert.equal(updatedTeam.members, 1);
  } finally {
    socket.close();
    await relay.close();
  }
});

test("relay updates team member count from room presence", async () => {
  const relay = await startRelay(
    {},
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team-core", name: "Core Team", members: 1 }],
      rooms: [
        {
          id: "room-desktop",
          teamId: "team-core",
          name: "Desktop client",
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
      teamMembers: [{ teamId: "team-core", userIds: ["github:first"] }],
      encryptedBacklog: []
    }
  );
  const workspace = new WebSocket(relay.wsUrl);
  const member = new WebSocket(relay.wsUrl);
  try {
    await Promise.all([onceOpen(workspace), onceOpen(member)]);
    workspace.send(
      JSON.stringify({
        type: "subscribe.workspace",
        userId: "github:watcher",
        deviceId: "device-watch-123"
      })
    );
    member.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:second",
        deviceId: "device-second-123"
      })
    );
    await waitForJoined(member);

    const updatePromise = waitForTeamUpdated(workspace);
    member.send(
      JSON.stringify({
        type: "presence",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:second",
        deviceId: "device-second-123",
        displayName: "Second"
      })
    );

    const updatedTeam = await updatePromise;
    assert.equal(updatedTeam.id, "team-core");
    assert.equal(updatedTeam.members, 2);
  } finally {
    workspace.close();
    member.close();
    await relay.close();
  }
});

test("relay does not store plaintext room metadata events in encrypted backlog", async () => {
  const relay = await startRelay();
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

    const response = await fetch(`${relay.baseUrl}/rooms/room-desktop/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        codexModel: "gpt-5.4-thinking"
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await debugBacklog(relay.baseUrl), []);

    sender.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope()
      })
    );
    await waitForDebugBacklog(relay.baseUrl, 1);
    const backlog = await debugBacklog(relay.baseUrl);
    assert.equal(backlog[0]?.envelopes, 1);
    assert.equal(backlog[0]?.sample?.kind, "browser.event");
    assert.equal(backlog[0]?.sample?.payloadAlgorithm, "AES-GCM-256");
  } finally {
    sender.close();
    await relay.close();
  }
});

test("relay prunes encrypted backlog by retention window", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_BACKLOG_RETENTION_DAYS: "1" });
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

    sender.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({
          id: "envelope-expired",
          createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
        })
      })
    );
    sender.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({ id: "envelope-fresh" })
      })
    );

    await waitForDebugBacklog(relay.baseUrl, 1);
    const backlog = await debugBacklog(relay.baseUrl);
    assert.equal(backlog[0]?.envelopes, 1);
    assert.equal(backlog[0]?.sample?.id, "envelope-fresh");
  } finally {
    sender.close();
    await relay.close();
  }
});

test("relay rejects oversized encrypted room envelopes", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_ENVELOPE_MAX_BYTES: "4096" });
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

    const idError = waitForError(sender);
    sender.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({ id: `envelope-${"x".repeat(200)}` })
      })
    );
    assert.match(await idError, /Encrypted room envelope exceeds relay limits/);

    const sizeError = waitForError(sender);
    sender.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({
          id: "envelope-oversized-ciphertext",
          payload: {
            algorithm: "AES-GCM-256",
            nonce: "test-nonce",
            ciphertext: "x".repeat(6000)
          }
        })
      })
    );
    assert.match(await sizeError, /Encrypted room envelope exceeds relay limits/);
    assert.deepEqual(await debugBacklog(relay.baseUrl), []);
  } finally {
    sender.close();
    await relay.close();
  }
});

test("relay prunes oversized encrypted backlog loaded from store", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_ENVELOPE_MAX_BYTES: "4096" });
  try {
    await relay.close({ preserveData: true });
    const state = JSON.parse(await readFile(relay.dataPath, "utf8")) as StoredRelayStateFixture;
    state.encryptedBacklog = [
      {
        key: "team-core:room-desktop",
        envelopes: [
          testEnvelope({ id: "envelope-kept" }),
          testEnvelope({
            id: "envelope-pruned",
            payload: {
              algorithm: "AES-GCM-256",
              nonce: "test-nonce",
              ciphertext: "x".repeat(6000)
            }
          })
        ]
      }
    ];
    await writeFile(relay.dataPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const restarted = await startRelay(
      {
        MULTAIPLAYER_RELAY_ENVELOPE_MAX_BYTES: "4096"
      },
      undefined,
      relay.dataPath
    );
    try {
      const backlog = await debugBacklog(restarted.baseUrl);
      assert.equal(backlog[0]?.envelopes, 1);
      assert.equal(backlog[0]?.sample?.id, "envelope-kept");
    } finally {
      await restarted.close();
    }
  } finally {
    await rm(relay.tempDir, { recursive: true, force: true });
  }
});

test("relay drops malformed and cross-room encrypted backlog loaded from store", async () => {
  const relay = await startRelay(
    { MULTAIPLAYER_RELAY_SEED_DEMO: "false" },
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team-core", name: "Core Team", members: 1 }],
      rooms: [
        {
          id: "room-desktop",
          teamId: "team-core",
          name: "Desktop client",
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
      encryptedBacklog: [
        {
          key: "team-core:room-desktop",
          envelopes: [
            testEnvelope({ id: "envelope-kept" }),
            testEnvelope({ id: "envelope-wrong-room", roomId: "room-other" }),
            testEnvelope({
              id: "envelope-device-sealed-wrong-kind",
              kind: "browser.event",
              payload: deviceSealedPayload()
            }),
            { id: "not-a-valid-envelope" }
          ]
        },
        {
          key: "team-core:room-missing",
          envelopes: [testEnvelope({ id: "envelope-missing-room" })]
        },
        {
          key: "team-core:room-desktop:extra",
          envelopes: [testEnvelope({ id: "envelope-bad-key" })]
        },
        {
          key: "team-core:room-desktop",
          envelopes: "not an array"
        }
      ]
    }
  );
  try {
    const backlog = await debugBacklog(relay.baseUrl);
    assert.equal(backlog.length, 1);
    assert.equal(backlog[0]?.key, "team-core:room-desktop");
    assert.equal(backlog[0]?.envelopes, 1);
    assert.equal(backlog[0]?.sample?.id, "envelope-kept");
  } finally {
    await relay.close();
  }
});

test("relay accepts and broadcasts encrypted browser status events", async () => {
  const relay = await startRelay();
  const receiver = new WebSocket(relay.wsUrl);
  const sender = new WebSocket(relay.wsUrl);
  try {
    await Promise.all([onceOpen(receiver), onceOpen(sender)]);
    const join = {
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    };
    receiver.send(JSON.stringify(join));
    sender.send(JSON.stringify({ ...join, deviceId: "device-test-456" }));

    const envelopePromise = waitForEnvelope(receiver, "browser.event");
    const envelope = testEnvelope({
      id: "envelope-browser-event-test",
      senderDeviceId: "device-test-456",
      kind: "browser.event"
    });
    sender.send(JSON.stringify({ type: "publish", envelope }));

    const received = await envelopePromise;
    assert.equal(received.id, envelope.id);
    assert.equal(received.kind, "browser.event");
  } finally {
    receiver.close();
    sender.close();
    await relay.close();
  }
});

test("relay ignores duplicate encrypted envelopes by room id", async () => {
  const relay = await startRelay();
  const receiver = new WebSocket(relay.wsUrl);
  const sender = new WebSocket(relay.wsUrl);
  try {
    await Promise.all([onceOpen(receiver), onceOpen(sender)]);
    const join = {
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    };
    receiver.send(JSON.stringify(join));
    sender.send(JSON.stringify({ ...join, deviceId: "device-test-456" }));

    const envelope = testEnvelope({
      id: "envelope-duplicate-test",
      senderDeviceId: "device-test-456",
      kind: "browser.event"
    });
    const firstEnvelopePromise = waitForEnvelope(receiver, "browser.event");
    sender.send(JSON.stringify({ type: "publish", envelope }));

    assert.equal((await firstEnvelopePromise).id, envelope.id);
    const duplicateEnvelopePromise = waitForEnvelope(receiver, "browser.event", 300);
    sender.send(JSON.stringify({ type: "publish", envelope }));
    await assert.rejects(duplicateEnvelopePromise, /Timed out waiting for envelope/);
    await waitForDebugBacklog(relay.baseUrl, 1);
    const backlog = await debugBacklog(relay.baseUrl);
    assert.equal(backlog[0]?.envelopes, 1);
    assert.equal(backlog[0]?.sample?.id, envelope.id);
  } finally {
    receiver.close();
    sender.close();
    await relay.close();
  }
});

test("relay replays encrypted backlog after restart when a client rejoins", async () => {
  const relay = await startRelay();
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

    const envelope = testEnvelope({ id: "envelope-restart-backlog" });
    sender.send(JSON.stringify({ type: "publish", envelope }));
    await waitForDebugBacklog(relay.baseUrl, 1);

    sender.close();
    await relay.close({ preserveData: true });
    restarted = await startRelay({}, undefined, relay.dataPath);

    const receiver = new WebSocket(restarted.wsUrl);
    try {
      await onceOpen(receiver);
      const replayedEnvelope = waitForEnvelope(receiver, "browser.event");
      receiver.send(
        JSON.stringify({
          type: "join",
          teamId: "team-core",
          roomId: "room-desktop",
          userId: "github:tester",
          deviceId: "device-restart-456"
        })
      );
      await waitForJoined(receiver);
      assert.equal((await replayedEnvelope).id, envelope.id);
    } finally {
      receiver.close();
    }
  } finally {
    sender.close();
    if (restarted) {
      await restarted.close();
    } else {
      await relay.close().catch(() => {});
    }
  }
});

test("relay accepts and broadcasts encrypted terminal result events", async () => {
  const relay = await startRelay();
  const receiver = new WebSocket(relay.wsUrl);
  const sender = new WebSocket(relay.wsUrl);
  try {
    await Promise.all([onceOpen(receiver), onceOpen(sender)]);
    const join = {
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    };
    receiver.send(JSON.stringify(join));
    sender.send(JSON.stringify({ ...join, deviceId: "device-test-456" }));

    const envelopePromise = waitForEnvelope(receiver, "terminal.event");
    const envelope = testEnvelope({
      id: "envelope-terminal-result-test",
      senderDeviceId: "device-test-456",
      kind: "terminal.event"
    });
    sender.send(JSON.stringify({ type: "publish", envelope }));

    const received = await envelopePromise;
    assert.equal(received.id, envelope.id);
    assert.equal(received.kind, "terminal.event");
  } finally {
    receiver.close();
    sender.close();
    await relay.close();
  }
});

test("relay accepts and broadcasts encrypted git workflow events", async () => {
  const relay = await startRelay();
  const receiver = new WebSocket(relay.wsUrl);
  const sender = new WebSocket(relay.wsUrl);
  try {
    await Promise.all([onceOpen(receiver), onceOpen(sender)]);
    const join = {
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    };
    receiver.send(JSON.stringify(join));
    sender.send(JSON.stringify({ ...join, deviceId: "device-test-456" }));

    const envelopePromise = waitForEnvelope(receiver, "git.event");
    const envelope = testEnvelope({
      id: "envelope-git-workflow-test",
      senderDeviceId: "device-test-456",
      kind: "git.event"
    });
    sender.send(JSON.stringify({ type: "publish", envelope }));

    const received = await envelopePromise;
    assert.equal(received.id, envelope.id);
    assert.equal(received.kind, "git.event");
  } finally {
    receiver.close();
    sender.close();
    await relay.close();
  }
});

test("relay accepts device-sealed invite events and rejects other sealed event kinds", async () => {
  const relay = await startRelay();
  const receiver = new WebSocket(relay.wsUrl);
  const sender = new WebSocket(relay.wsUrl);
  try {
    await Promise.all([onceOpen(receiver), onceOpen(sender)]);
    const join = {
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    };
    receiver.send(JSON.stringify(join));
    sender.send(JSON.stringify({ ...join, deviceId: "device-test-456" }));

    const invitePromise = waitForEnvelope(receiver, "room.invite");
    const inviteEnvelope = testEnvelope({
      id: "envelope-device-sealed-invite",
      senderDeviceId: "device-test-456",
      kind: "room.invite",
      payload: deviceSealedPayload()
    });
    sender.send(JSON.stringify({ type: "publish", envelope: inviteEnvelope }));
    const receivedInvite = await invitePromise;
    assert.equal(receivedInvite.id, inviteEnvelope.id);
    assert.equal(receivedInvite.payload.algorithm, "ECDH-P256-HKDF-SHA256-AES-GCM-256");

    const rejected = waitForError(sender);
    sender.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({
          id: "envelope-device-sealed-terminal",
          senderDeviceId: "device-test-456",
          kind: "terminal.event",
          payload: deviceSealedPayload()
        })
      })
    );
    assert.equal(await rejected, "Device-sealed envelopes are only supported for room invites.");
  } finally {
    receiver.close();
    sender.close();
    await relay.close();
  }
});

test("relay rejects websocket room and identity mismatches", async () => {
  const relay = await startRelay();
  const socket = new WebSocket(relay.wsUrl);
  try {
    await onceOpen(socket);

    const firstError = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-missing",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );
    assert.equal(await firstError, "Room not found");

    const publishBeforeJoinError = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({ senderDeviceId: "device-test-123" })
      })
    );
    assert.equal(await publishBeforeJoinError, "Join the room before publishing with this user and device.");

    socket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );

    const publishMismatchError = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({ senderDeviceId: "device-other-456" })
      })
    );
    assert.equal(await publishMismatchError, "Join the room before publishing with this user and device.");

    const presenceMismatchError = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "presence",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:other",
        deviceId: "device-test-123",
        displayName: "Other"
      })
    );
    assert.equal(await presenceMismatchError, "Join the room before publishing presence with this user and device.");
  } finally {
    socket.close();
    await relay.close();
  }
});

test("relay bounds websocket identity and presence metadata", async () => {
  const relay = await startRelay();
  const socket = new WebSocket(relay.wsUrl);
  try {
    await onceOpen(socket);

    const joinError = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123".padEnd(170, "x")
      })
    );
    assert.match(await joinError, /WebSocket user and device ids must be bounded/);

    const subscribeError = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "subscribe.workspace",
        userId: "github:tester".padEnd(170, "x"),
        deviceId: "device-test-123"
      })
    );
    assert.match(await subscribeError, /WebSocket user and device ids must be bounded/);

    socket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );
    await waitForJoined(socket);

    const displayNameError = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "presence",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123",
        displayName: "x".repeat(121)
      })
    );
    assert.match(await displayNameError, /Presence display name/);

    const fingerprintError = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "presence",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123",
        displayName: "Tester",
        publicKeyFingerprint: "x".repeat(129)
      })
    );
    assert.match(await fingerprintError, /Presence display name/);
  } finally {
    socket.close();
    await relay.close();
  }
});

test("relay enriches presence with registered device fingerprints", async () => {
  const relay = await startRelay(
    {},
    {
      version: 1,
      savedAt: new Date().toISOString(),
      teams: [{ id: "team-core", name: "Core Team", members: 1 }],
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
          codexModel: "gpt-5.4-codex",
          browserAllowedOrigins: ["https://github.com"],
          browserProfilePersistent: true,
          unread: 0
        }
      ],
      invites: [],
      devices: [
        {
          userId: "github:tester",
          deviceId: "device-test-123",
          displayName: "Tester",
          publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
          publicKeyFingerprint: "sha256:registered-device-key",
          registeredAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString()
        },
        {
          userId: "github:tester",
          deviceId: "device-private-key",
          displayName: "Tester",
          publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "private-material" },
          publicKeyFingerprint: "sha256:must-not-be-trusted",
          registeredAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString()
        }
      ],
      encryptedBacklog: []
    }
  );
  const socket = new WebSocket(relay.wsUrl);
  const untrustedSocket = new WebSocket(relay.wsUrl);
  try {
    await Promise.all([onceOpen(socket), onceOpen(untrustedSocket)]);
    socket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );
    await waitForJoined(socket);

    const presencePromise = waitForPresence(socket, "device-test-123");
    socket.send(
      JSON.stringify({
        type: "presence",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123",
        displayName: "Tester",
        publicKeyFingerprint: "sha256:untrusted-client-value"
      })
    );

    const presence = await presencePromise;
    assert.equal(presence.publicKeyFingerprint, "sha256:registered-device-key");
    assert.equal(presence.status, "online");

    untrustedSocket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-private-key"
      })
    );
    await waitForJoined(untrustedSocket);

    const untrustedPresencePromise = waitForPresence(untrustedSocket, "device-private-key");
    untrustedSocket.send(
      JSON.stringify({
        type: "presence",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-private-key",
        displayName: "Tester",
        publicKeyFingerprint: "sha256:client-presented-key"
      })
    );

    const untrustedPresence = await untrustedPresencePromise;
    assert.equal(untrustedPresence.publicKeyFingerprint, "sha256:client-presented-key");
  } finally {
    socket.close();
    untrustedSocket.close();
    await relay.close();
  }
});

test("relay rate limits room WebSocket events per client", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000"
  });
  const socket = new WebSocket(relay.wsUrl, { headers: { "x-forwarded-for": "203.0.113.12" } });
  try {
    await onceOpen(socket);
    socket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );
    await waitForJoined(socket);

    const errorPromise = waitForError(socket);
    socket.send(
      JSON.stringify({
        type: "publish",
        envelope: testEnvelope({ senderDeviceId: "device-test-123" })
      })
    );
    assert.match(await errorPromise, /Rate limit exceeded/);
  } finally {
    socket.close();
    await relay.close();
  }
});

test("relay rate limits WebSocket connection attempts per client", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000"
  });
  const first = new WebSocket(relay.wsUrl);
  let second: WebSocket | null = null;
  try {
    await onceOpen(first);
    second = new WebSocket(relay.wsUrl);
    const errorPromise = waitForError(second);
    const closePromise = waitForClose(second);
    assert.match(await errorPromise, /WebSocket connection rate limit exceeded/);
    const close = await closePromise;
    assert.equal(close.code, 1008);

    const metrics = await fetch(`${relay.baseUrl}/metrics`);
    assert.equal(metrics.status, 200);
    const body = (await metrics.json()) as {
      rateLimitRejectionsTotal?: unknown;
      rateLimitRejectionsByBucket?: Record<string, unknown>;
      webSocketConnectionAttemptsTotal?: unknown;
      webSocketConnectionsAcceptedTotal?: unknown;
      webSocketConnectionRejectionsByReason?: Record<string, unknown>;
    };
    assert.equal(body.rateLimitRejectionsTotal, 1);
    assert.equal(body.rateLimitRejectionsByBucket?.websocketconnect, 1);
    assert.equal(body.webSocketConnectionAttemptsTotal, 2);
    assert.equal(body.webSocketConnectionsAcceptedTotal, 1);
    assert.equal(body.webSocketConnectionRejectionsByReason?.rate_limit, 1);
  } finally {
    first.close();
    second?.close();
    await relay.close();
  }
});

test("relay caps concurrent room WebSocket connections per device", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER: "10",
    MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_DEVICE: "1"
  });
  const first = new WebSocket(relay.wsUrl);
  const second = new WebSocket(relay.wsUrl);
  try {
    await Promise.all([onceOpen(first), onceOpen(second)]);
    first.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );
    await waitForJoined(first);

    const errorPromise = waitForError(second);
    const closePromise = waitForClose(second);
    second.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "device-test-123"
      })
    );
    assert.match(await errorPromise, /Concurrent WebSocket connection quota exceeded for this device/);
    const close = await closePromise;
    assert.equal(close.code, 1008);

    const metrics = await fetch(`${relay.baseUrl}/metrics`);
    assert.equal(metrics.status, 200);
    const body = (await metrics.json()) as {
      quotaRejectionsTotal?: unknown;
      quotaRejectionsByType?: Record<string, unknown>;
    };
    assert.equal(body.quotaRejectionsTotal, 1);
    assert.equal(body.quotaRejectionsByType?.websocket_connections_per_device, 1);
  } finally {
    first.close();
    second.close();
    await relay.close();
  }
});

test("relay caps concurrent WebSocket connections per user identity", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER: "1",
    MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_DEVICE: "5"
  });
  const first = new WebSocket(relay.wsUrl);
  let second: WebSocket | null = null;
  try {
    await onceOpen(first);
    second = new WebSocket(relay.wsUrl);
    const errorPromise = waitForError(second);
    const closePromise = waitForClose(second);
    assert.match(await errorPromise, /Concurrent WebSocket connection quota exceeded for this user/);
    const close = await closePromise;
    assert.equal(close.code, 1008);

    const metrics = await fetch(`${relay.baseUrl}/metrics`);
    assert.equal(metrics.status, 200);
    const body = (await metrics.json()) as {
      quotaRejectionsTotal?: unknown;
      quotaRejectionsByType?: Record<string, unknown>;
    };
    assert.equal(body.quotaRejectionsTotal, 1);
    assert.equal(body.quotaRejectionsByType?.websocket_connections_per_user, 1);
  } finally {
    first.close();
    second?.close();
    await relay.close();
  }
});

test("relay applies configured WebSocket origin allowlist", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com/ http://127.0.0.1:1420"
  });
  const allowed = new WebSocket(relay.wsUrl, { headers: { origin: "https://multaiplayer.com" } });
  const denied = new WebSocket(relay.wsUrl, { headers: { origin: "https://example.com" } });
  try {
    await onceOpen(allowed);
    assert.match(await waitForRejectedOpen(denied), /Unexpected server response: 403/);
  } finally {
    allowed.close();
    denied.close();
    await relay.close();
  }
});

test("relay denies browser WebSocket origins by default in production", async () => {
  const relay = await startRelay({ NODE_ENV: "production" });
  const socket = new WebSocket(relay.wsUrl, { headers: { origin: "https://multaiplayer.com" } });
  try {
    assert.match(await waitForRejectedOpen(socket), /Unexpected server response: 403/);
  } finally {
    socket.close();
    await relay.close();
  }
});
