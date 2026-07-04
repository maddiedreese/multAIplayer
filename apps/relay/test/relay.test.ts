import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

interface RelayHarness {
  baseUrl: string;
  wsUrl: string;
  dataPath: string;
  tempDir: string;
  close(options?: { preserveData?: boolean }): Promise<void>;
}

interface StoredRelayStateFixture {
  version: 1;
  savedAt: string;
  teams: unknown[];
  rooms: unknown[];
  invites: unknown[];
  devices?: unknown[];
  authSessions?: Array<{
    sessionId?: string;
    encryptedAccessToken?: { algorithm?: string };
    accessToken?: string;
    user?: unknown;
    expiresAt?: number;
  }>;
  attachmentBlobs?: unknown[];
  encryptedBacklog: unknown[];
}

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
      await patchHostStatus(relay.baseUrl, { host: "Maddie", hostUserId: "github:maddiedreese", hostStatus: "handoff" }),
      200
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, { host: "Peer", hostUserId: "github:peer", hostStatus: "active" }),
      200
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, { host: "Maddie", hostUserId: "github:maddiedreese", hostStatus: "offline" }),
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
    socket.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));

    const updatePromise = waitForRoomUpdated(socket);
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

    const updatedRoom = await updatePromise;
    assert.equal(updatedRoom.id, "room-desktop");
    assert.equal(updatedRoom.codexModel, "gpt-5.4-thinking");
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
    socket.send(JSON.stringify({
      type: "subscribe.team",
      teamId: "team-core",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));

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
    socket.send(JSON.stringify({
      type: "subscribe.workspace",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));

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
  const relay = await startRelay({}, {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [{ id: "team-core", name: "Core Team", members: 1 }],
    rooms: [{
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
      unread: 0
    }],
    invites: [],
    teamMembers: [{ teamId: "team-core", userIds: ["github:first"] }],
    encryptedBacklog: []
  });
  const workspace = new WebSocket(relay.wsUrl);
  const member = new WebSocket(relay.wsUrl);
  try {
    await Promise.all([onceOpen(workspace), onceOpen(member)]);
    workspace.send(JSON.stringify({
      type: "subscribe.workspace",
      userId: "github:watcher",
      deviceId: "device-watch-123"
    }));
    member.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:second",
      deviceId: "device-second-123"
    }));
    await waitForJoined(member);

    const updatePromise = waitForTeamUpdated(workspace);
    member.send(JSON.stringify({
      type: "presence",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:second",
      deviceId: "device-second-123",
      displayName: "Second"
    }));

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
    sender.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));

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

    sender.send(JSON.stringify({
      type: "publish",
      envelope: testEnvelope()
    }));
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
    sender.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));

    sender.send(JSON.stringify({
      type: "publish",
      envelope: testEnvelope({
        id: "envelope-expired",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      })
    }));
    sender.send(JSON.stringify({
      type: "publish",
      envelope: testEnvelope({ id: "envelope-fresh" })
    }));

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
    sender.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));
    await waitForJoined(sender);

    const idError = waitForError(sender);
    sender.send(JSON.stringify({
      type: "publish",
      envelope: testEnvelope({ id: `envelope-${"x".repeat(200)}` })
    }));
    assert.match(await idError, /Encrypted room envelope exceeds relay limits/);

    const sizeError = waitForError(sender);
    sender.send(JSON.stringify({
      type: "publish",
      envelope: testEnvelope({
        id: "envelope-oversized-ciphertext",
        payload: {
          algorithm: "AES-GCM-256",
          nonce: "test-nonce",
          ciphertext: "x".repeat(6000)
        }
      })
    }));
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
    state.encryptedBacklog = [{
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
    }];
    await writeFile(relay.dataPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const restarted = await startRelay({
      MULTAIPLAYER_RELAY_ENVELOPE_MAX_BYTES: "4096"
    }, undefined, relay.dataPath);
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
    sender.send(JSON.stringify({
      type: "publish",
      envelope: testEnvelope({
        id: "envelope-device-sealed-terminal",
        senderDeviceId: "device-test-456",
        kind: "terminal.event",
        payload: deviceSealedPayload()
      })
    }));
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
    socket.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-missing",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));
    assert.equal(await firstError, "Room not found");

    const publishBeforeJoinError = waitForError(socket);
    socket.send(JSON.stringify({
      type: "publish",
      envelope: testEnvelope({ senderDeviceId: "device-test-123" })
    }));
    assert.equal(await publishBeforeJoinError, "Join the room before publishing with this user and device.");

    socket.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));

    const publishMismatchError = waitForError(socket);
    socket.send(JSON.stringify({
      type: "publish",
      envelope: testEnvelope({ senderDeviceId: "device-other-456" })
    }));
    assert.equal(await publishMismatchError, "Join the room before publishing with this user and device.");

    const presenceMismatchError = waitForError(socket);
    socket.send(JSON.stringify({
      type: "presence",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:other",
      deviceId: "device-test-123",
      displayName: "Other"
    }));
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
    socket.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123".padEnd(170, "x")
    }));
    assert.match(await joinError, /WebSocket user and device ids must be bounded/);

    const subscribeError = waitForError(socket);
    socket.send(JSON.stringify({
      type: "subscribe.workspace",
      userId: "github:tester".padEnd(170, "x"),
      deviceId: "device-test-123"
    }));
    assert.match(await subscribeError, /WebSocket user and device ids must be bounded/);

    socket.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));
    await waitForJoined(socket);

    const displayNameError = waitForError(socket);
    socket.send(JSON.stringify({
      type: "presence",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123",
      displayName: "x".repeat(121)
    }));
    assert.match(await displayNameError, /Presence display name/);

    const fingerprintError = waitForError(socket);
    socket.send(JSON.stringify({
      type: "presence",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123",
      displayName: "Tester",
      publicKeyFingerprint: "x".repeat(129)
    }));
    assert.match(await fingerprintError, /Presence display name/);
  } finally {
    socket.close();
    await relay.close();
  }
});

test("relay enriches presence with registered device fingerprints", async () => {
  const relay = await startRelay({}, {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [{ id: "team-core", name: "Core Team", members: 1 }],
    rooms: [{
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
      unread: 0
    }],
    invites: [],
    devices: [{
      userId: "github:tester",
      deviceId: "device-test-123",
      displayName: "Tester",
      publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
      publicKeyFingerprint: "sha256:registered-device-key",
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    }],
    encryptedBacklog: []
  });
  const socket = new WebSocket(relay.wsUrl);
  try {
    await onceOpen(socket);
    socket.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));
    await waitForJoined(socket);

    const presencePromise = waitForPresence(socket);
    socket.send(JSON.stringify({
      type: "presence",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123",
      displayName: "Tester",
      publicKeyFingerprint: "sha256:untrusted-client-value"
    }));

    const presence = await presencePromise;
    assert.equal(presence.publicKeyFingerprint, "sha256:registered-device-key");
    assert.equal(presence.status, "online");
  } finally {
    socket.close();
    await relay.close();
  }
});

test("relay lets only the active host change room settings", async () => {
  const relay = await startRelay();
  try {
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Peer",
        requesterUserId: "github:peer",
        codexModel: "gpt-5.4-thinking"
      }),
      403
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        codexModel: "gpt-5.4-thinking"
      }),
      200
    );
  } finally {
    await relay.close();
  }
});

test("relay bounds room project paths and Codex model metadata", async () => {
  const relay = await startRelay();
  try {
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Bad path",
        projectPath: "/tmp/project\u0000secret"
      }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Long path",
        projectPath: `/${"a".repeat(2049)}`
      }),
      400
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        codexModel: "bad model with spaces"
      }),
      400
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        projectPath: "/Users/maddie/dev/multAIplayer",
        codexModel: "provider/custom-model:v1"
      }),
      200
    );
  } finally {
    await relay.close();
  }
});

test("relay bounds user-visible metadata strings", async () => {
  const relay = await startRelay();
  try {
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/teams", { name: "x".repeat(121) }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "x".repeat(161),
        projectPath: "/tmp/multaiplayer"
      }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/devices", {
        userId: "github:maddiedreese",
        deviceId: "x".repeat(161),
        displayName: "Maddie",
        publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
        publicKeyFingerprint: "fingerprint"
      }),
      400
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/devices", {
        userId: "github:maddiedreese",
        deviceId: "device-ok",
        displayName: "Maddie",
        publicKeyJwk: { kty: "EC", crv: "P-256", x: "x".repeat(5000), y: "y" },
        publicKeyFingerprint: "fingerprint"
      }),
      400
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, {
        host: "x".repeat(121),
        hostUserId: "github:maddiedreese",
        hostStatus: "active"
      }),
      400
    );
  } finally {
    await relay.close();
  }
});

test("relay reports configured GitHub OAuth scopes", async () => {
  const relay = await startRelay({
    GITHUB_OAUTH_SCOPES: "read:user,repo workflow",
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com,tauri://localhost",
    MULTAIPLAYER_RELAY_SESSION_SECRET: "test-session-secret-with-at-least-32-characters"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      scopes: string[];
      mutationsRequireAuth: boolean;
      allowedOrigins: string[];
      sessionPersistence: string;
    };
    assert.deepEqual(body.scopes, ["read:user", "repo", "workflow"]);
    assert.equal(body.mutationsRequireAuth, true);
    assert.deepEqual(body.allowedOrigins, ["https://multaiplayer.com", "tauri://localhost"]);
    assert.equal(body.sessionPersistence, "encrypted");
  } finally {
    await relay.close();
  }
});

test("relay loads configuration from env files without overriding process env", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "multaiplayer-relay-env-test-"));
  const envPath = join(tempDir, ".env");
  await writeFile(envPath, [
    "GITHUB_OAUTH_SCOPES=\"read:user repo\"",
    "MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://env-file.example/ # normalized",
    "MULTAIPLAYER_RELAY_REQUIRE_AUTH=false"
  ].join("\n"), "utf8");
  const relay = await startRelay({
    GITHUB_OAUTH_SCOPES: "read:user workflow",
    MULTAIPLAYER_RELAY_ENV_FILE: envPath
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      scopes: string[];
      mutationsRequireAuth: boolean;
      allowedOrigins: string[];
    };
    assert.deepEqual(body.scopes, ["read:user", "workflow"]);
    assert.equal(body.mutationsRequireAuth, false);
    assert.deepEqual(body.allowedOrigins, ["https://env-file.example"]);
  } finally {
    await relay.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("relay normalizes configured CORS origins", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com/ https://multaiplayer.com tauri://localhost https://bad.example/path"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(response.status, 200);
    const body = await response.json() as { allowedOrigins: string[] };
    assert.deepEqual(body.allowedOrigins, ["https://multaiplayer.com", "tauri://localhost"]);
  } finally {
    await relay.close();
  }
});

test("relay reports memory-only sessions when persistence is disabled or weak", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_SESSION_SECRET: "short-secret"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(response.status, 200);
    const body = await response.json() as { sessionPersistence: string };
    assert.equal(body.sessionPersistence, "memory_only");
  } finally {
    await relay.close();
  }
});

test("relay rate limits repeated HTTP reads and mutations", async () => {
  const readLimitedRelay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_READ: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000"
  });
  try {
    const headers = { "x-forwarded-for": "203.0.113.10" };
    const first = await fetch(`${readLimitedRelay.baseUrl}/teams`, { headers });
    assert.equal(first.status, 200);
    const second = await fetch(`${readLimitedRelay.baseUrl}/teams`, { headers });
    assert.equal(second.status, 429);
    assert.equal(second.headers.get("retry-after"), "60");
    assert.match(await second.text(), /Rate limit exceeded/);
  } finally {
    await readLimitedRelay.close();
  }

  const mutationLimitedRelay = await startRelay({
    MULTAIPLAYER_RELAY_RATE_LIMIT_MUTATION: "1",
    MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS: "60000"
  });
  try {
    const headers = {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.11"
    };
    const first = await fetch(`${mutationLimitedRelay.baseUrl}/teams`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "One team" })
    });
    assert.equal(first.status, 201);
    const second = await fetch(`${mutationLimitedRelay.baseUrl}/teams`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Second team" })
    });
    assert.equal(second.status, 429);
  } finally {
    await mutationLimitedRelay.close();
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
    socket.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:tester",
      deviceId: "device-test-123"
    }));
    await waitForJoined(socket);

    const errorPromise = waitForError(socket);
    socket.send(JSON.stringify({
      type: "publish",
      envelope: testEnvelope({ senderDeviceId: "device-test-123" })
    }));
    assert.match(await errorPromise, /Rate limit exceeded/);
  } finally {
    socket.close();
    await relay.close();
  }
});

test("relay applies configured CORS origin allowlist", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "https://multaiplayer.com/ http://127.0.0.1:1420"
  });
  try {
    const allowed = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "https://multaiplayer.com" }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://multaiplayer.com");
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");

    const denied = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "https://example.com" }
    });
    assert.equal(denied.status, 200);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    assert.equal(denied.headers.get("access-control-allow-credentials"), null);
  } finally {
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

test("relay denies browser CORS origins by default in production", async () => {
  const relay = await startRelay({ NODE_ENV: "production" });
  try {
    const response = await fetch(`${relay.baseUrl}/auth/config`, {
      headers: { origin: "https://multaiplayer.com" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
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

test("relay can require auth for workspace mutations", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  try {
    assert.equal(await postJsonStatus(relay.baseUrl, "/teams", { name: "Private Team" }), 401);
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/devices", {
        userId: "github:maddiedreese",
        deviceId: "device-private-123",
        displayName: "Maddie",
        publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
        publicKeyFingerprint: "sha256:private-device"
      }),
      401
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/rooms", {
        teamId: "team-core",
        name: "Private Room",
        projectPath: "/tmp/multaiplayer"
      }),
      401
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/invites", {
        teamId: "team-core",
        roomId: "room-desktop"
      }),
      401
    );
    assert.equal(
      await postJsonStatus(relay.baseUrl, "/attachment-blobs", {
        teamId: "team-core",
        roomId: "room-desktop",
        name: "private.txt",
        type: "text/plain",
        size: 4,
        payload: {
          algorithm: "AES-GCM-256",
          nonce: "test-nonce",
          ciphertext: "test-ciphertext"
        }
      }),
      401
    );
    assert.equal(
      await patchHostStatus(relay.baseUrl, {
        host: "Maddie",
        hostUserId: "github:maddiedreese",
        hostStatus: "handoff"
      }),
      401
    );
    assert.equal(
      await patchRoomSettings(relay.baseUrl, {
        requesterName: "Maddie",
        requesterUserId: "github:maddiedreese",
        codexModel: "gpt-5.4-thinking"
      }),
      401
    );
  } finally {
    await relay.close();
  }
});

test("relay expires server-side auth sessions independently of cookies", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  try {
    const expiredCookie = await createDebugSession(relay.baseUrl, "github:expired", "expired", -1);

    const me = await fetch(`${relay.baseUrl}/auth/me`, {
      headers: { cookie: expiredCookie }
    });
    assert.equal(me.status, 401);

    const teams = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: expiredCookie }
    });
    assert.equal(teams.status, 401);
  } finally {
    await relay.close();
  }
});

test("relay logout clears the session cookie with matching attributes", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:logout", "logout");
    const response = await fetch(`${relay.baseUrl}/auth/logout`, {
      method: "POST",
      headers: { cookie }
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get("set-cookie");
    assert.ok(setCookie);
    assert.match(setCookie, /^multaiplayer_session=;/);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);

    const me = await fetch(`${relay.baseUrl}/auth/me`, {
      headers: { cookie }
    });
    assert.equal(me.status, 401);
  } finally {
    await relay.close();
  }
});

test("relay persists auth sessions encrypted when a session secret is configured", async () => {
  const strongSecret = "test-session-secret-with-at-least-32-characters";
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
    MULTAIPLAYER_RELAY_SESSION_SECRET: strongSecret
  });
  let restarted: RelayHarness | null = null;
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:persisted", "persisted");
    const stored = await waitForStoredState(relay.dataPath, (state) => Array.isArray(state.authSessions) && state.authSessions.length === 1);
    assert.doesNotMatch(JSON.stringify(stored), /debug-token/);
    assert.equal(stored.authSessions?.[0]?.encryptedAccessToken?.algorithm, "AES-GCM-256");

    await relay.close({ preserveData: true });
    restarted = await startRelay({
      MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
      MULTAIPLAYER_RELAY_SESSION_SECRET: strongSecret
    }, undefined, relay.dataPath);

    const me = await fetch(`${restarted.baseUrl}/auth/me`, {
      headers: { cookie }
    });
    assert.equal(me.status, 200);
    const body = await me.json() as { user: { id: string; login: string } };
    assert.equal(body.user.id, "github:persisted");
    assert.equal(body.user.login, "persisted");
  } finally {
    if (restarted) {
      await restarted.close();
    } else {
      await relay.close();
    }
  }
});

test("relay ignores weak auth session persistence secrets", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
    MULTAIPLAYER_RELAY_SESSION_SECRET: "short-secret"
  });
  let restarted: RelayHarness | null = null;
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:weak-secret", "weak-secret");
    const stored = await waitForStoredState(relay.dataPath, (state) => Array.isArray(state.authSessions));
    assert.deepEqual(stored.authSessions, []);
    assert.doesNotMatch(JSON.stringify(stored), /debug-token/);

    await relay.close({ preserveData: true });
    restarted = await startRelay({
      MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
      MULTAIPLAYER_RELAY_SESSION_SECRET: "short-secret"
    }, undefined, relay.dataPath);
    const me = await fetch(`${restarted.baseUrl}/auth/me`, {
      headers: { cookie }
    });
    assert.equal(me.status, 401);
  } finally {
    if (restarted) {
      await restarted.close();
    } else {
      await relay.close();
    }
  }
});

test("relay keeps auth sessions memory-only without a session secret", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  let restarted: RelayHarness | null = null;
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:memory-only", "memory-only");
    const stored = await waitForStoredState(relay.dataPath, (state) => Array.isArray(state.authSessions));
    assert.deepEqual(stored.authSessions, []);
    assert.doesNotMatch(JSON.stringify(stored), /debug-token/);

    await relay.close({ preserveData: true });
    restarted = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" }, undefined, relay.dataPath);
    const me = await fetch(`${restarted.baseUrl}/auth/me`, {
      headers: { cookie }
    });
    assert.equal(me.status, 401);
  } finally {
    if (restarted) {
      await restarted.close();
    } else {
      await relay.close();
    }
  }
});

test("relay ignores plaintext auth access tokens loaded from disk", async () => {
  const relay = await startRelay({
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
    MULTAIPLAYER_RELAY_SESSION_SECRET: "test-session-secret-with-at-least-32-characters"
  }, {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [],
    rooms: [],
    invites: [],
    authSessions: [{
      sessionId: "plain-session",
      accessToken: "debug-token",
      user: { id: "github:plain", login: "plain" },
      expiresAt: Date.now() + 60_000
    }],
    encryptedBacklog: []
  });
  try {
    const me = await fetch(`${relay.baseUrl}/auth/me`, {
      headers: { cookie: "multaiplayer_session=plain-session" }
    });
    assert.equal(me.status, 401);

    await relay.close({ preserveData: true });
    const stored = JSON.parse(await readFile(relay.dataPath, "utf8")) as StoredRelayStateFixture;
    assert.deepEqual(stored.authSessions, []);
    assert.doesNotMatch(JSON.stringify(stored), /debug-token/);
  } finally {
    await relay.close().catch(() => {});
  }
});

test("relay validates GitHub PR and Actions inputs before proxying", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");

    const pullResponse = await fetch(`${relay.baseUrl}/github/pulls`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        owner: "maddiedreese/bad",
        repo: "multAIplayer",
        title: "Ship it",
        body: "",
        head: "codex/branch",
        base: "main",
        draft: true
      })
    });
    assert.equal(pullResponse.status, 400);
    assert.match(await pullResponse.text(), /GitHub owner/);

    const actionsResponse = await fetch(`${relay.baseUrl}/github/actions/runs?owner=maddiedreese&repo=multAIplayer&branch=bad%20branch`, {
      headers: { cookie }
    });
    assert.equal(actionsResponse.status, 400);
    assert.match(await actionsResponse.text(), /Unsafe GitHub branch name/);
  } finally {
    await relay.close();
  }
});

test("relay scopes authenticated workspace access to team members and admits invitees", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true" });
  const maddieCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
  const peerCookie = await createDebugSession(relay.baseUrl, "github:peer", "peer");
  let peerSocket: WebSocket | null = null;
  try {
    const unauthTeams = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(unauthTeams.status, 401);

    const peerWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: peerCookie }
    });
    assert.equal(peerWorkspace.status, 200);
    assert.deepEqual(await peerWorkspace.json(), { teams: [], rooms: [] });

    const deniedRoom = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: peerCookie },
      body: JSON.stringify({
        teamId: "team-core",
        name: "Peer room",
        projectPath: "/tmp/multaiplayer"
      })
    });
    assert.equal(deniedRoom.status, 403);

    const memberWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: maddieCookie }
    });
    assert.equal(memberWorkspace.status, 200);
    const memberBody = await memberWorkspace.json() as {
      teams: Array<{ id: string }>;
      rooms: Array<{ id: string }>;
    };
    assert.deepEqual(memberBody.teams.map((team) => team.id), ["team-core"]);
    assert.ok(memberBody.rooms.some((room) => room.id === "room-desktop"));
    assert.ok(!memberBody.rooms.some((room) => room.id === "room-github"));

    const inviteResponse = await fetch(`${relay.baseUrl}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: maddieCookie },
      body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
    });
    assert.equal(inviteResponse.status, 201);
    const inviteBody = await inviteResponse.json() as { invite: { id: string } };

    peerSocket = new WebSocket(relay.wsUrl, { headers: { cookie: peerCookie } });
    await onceOpen(peerSocket);
    peerSocket.send(JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId: "room-desktop",
      userId: "github:peer",
      deviceId: "device-peer-123",
      inviteId: inviteBody.invite.id
    }));
    await waitForJoined(peerSocket);

    const admittedWorkspace = await fetch(`${relay.baseUrl}/teams`, {
      headers: { cookie: peerCookie }
    });
    assert.equal(admittedWorkspace.status, 200);
    const admittedBody = await admittedWorkspace.json() as {
      teams: Array<{ id: string }>;
      rooms: Array<{ id: string }>;
    };
    assert.deepEqual(admittedBody.teams.map((team) => team.id), ["team-core"]);
    assert.ok(admittedBody.rooms.some((room) => room.id === "room-desktop"));
  } finally {
    peerSocket?.close();
    await relay.close();
  }
});

test("relay creates invite metadata with expiry", async () => {
  const relay = await startRelay({ MULTAIPLAYER_RELAY_INVITE_TTL_DAYS: "3" });
  try {
    const response = await fetch(`${relay.baseUrl}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
    });
    assert.equal(response.status, 201);
    const body = await response.json() as {
      invite: { createdAt: string; expiresAt?: string };
    };
    assert.ok(body.invite.expiresAt);
    assert.ok(Date.parse(body.invite.expiresAt) > Date.parse(body.invite.createdAt));
  } finally {
    await relay.close();
  }
});

test("relay stores encrypted attachment blobs as ciphertext", async () => {
  const relay = await startRelay({ MULTAIPLAYER_ATTACHMENT_BLOB_TTL_DAYS: "2" });
  try {
    const response = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        roomId: "room-desktop",
        name: "large-file.ts",
        type: "text/typescript",
        size: 120000,
        payload: {
          algorithm: "AES-GCM-256",
          nonce: "nonce-for-test",
          ciphertext: "ciphertext-without-plaintext"
        }
      })
    });
    assert.equal(response.status, 201);
    const created = await response.json() as {
      blob: { id: string; payload: { algorithm: string; ciphertext: string }; expiresAt?: string };
    };
    assert.match(created.blob.id, /^blob_/);
    assert.equal(created.blob.payload.algorithm, "AES-GCM-256");
    assert.equal(created.blob.payload.ciphertext, "ciphertext-without-plaintext");
    assert.ok(created.blob.expiresAt);

    const missingScopeResponse = await fetch(`${relay.baseUrl}/attachment-blobs/${created.blob.id}`);
    assert.equal(missingScopeResponse.status, 400);

    const wrongScopeResponse = await fetch(`${relay.baseUrl}/attachment-blobs/${created.blob.id}?teamId=team-core&roomId=room-other`);
    assert.equal(wrongScopeResponse.status, 404);
    const wrongScopeBody = await wrongScopeResponse.text();
    assert.doesNotMatch(wrongScopeBody, /large-file\.ts/);
    assert.doesNotMatch(wrongScopeBody, /ciphertext-without-plaintext/);

    const loadedResponse = await fetch(`${relay.baseUrl}/attachment-blobs/${created.blob.id}?teamId=team-core&roomId=room-desktop`);
    assert.equal(loadedResponse.status, 200);
    const loaded = await loadedResponse.json() as {
      blob: { name: string; payload: { ciphertext: string } };
    };
    assert.equal(loaded.blob.name, "large-file.ts");
    assert.equal(loaded.blob.payload.ciphertext, "ciphertext-without-plaintext");
  } finally {
    await relay.close();
  }
});

test("relay enforces encrypted attachment blob size limits", async () => {
  const relay = await startRelay({ MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES: "16" });
  try {
    const oversizedDeclared = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        roomId: "room-desktop",
        name: "too-large.txt",
        type: "text/plain",
        size: 17,
        payload: {
          algorithm: "AES-GCM-256",
          nonce: "nonce-for-test",
          ciphertext: "short-ciphertext"
        }
      })
    });
    assert.equal(oversizedDeclared.status, 413);
    assert.match(await oversizedDeclared.text(), /exceeds 16 bytes/);

    const oversizedCiphertext = await fetch(`${relay.baseUrl}/attachment-blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamId: "team-core",
        roomId: "room-desktop",
        name: "huge-ciphertext.txt",
        type: "text/plain",
        size: 8,
        payload: {
          algorithm: "AES-GCM-256",
          nonce: "nonce-for-test",
          ciphertext: "x".repeat(1500)
        }
      })
    });
    assert.equal(oversizedCiphertext.status, 413);
    assert.match(await oversizedCiphertext.text(), /ciphertext exceeds 16 bytes/);
  } finally {
    await relay.close();
  }
});

test("relay rejects expired invite metadata loaded from store", async () => {
  const relay = await startRelay({}, {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [],
    rooms: [],
    invites: [{
      id: "invite_expired",
      teamId: "team-core",
      roomId: "room-desktop",
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    }],
    encryptedBacklog: []
  });
  try {
    const response = await fetch(`${relay.baseUrl}/invites/invite_expired`);
    assert.equal(response.status, 404);
  } finally {
    await relay.close();
  }
});

test("relay prunes expired in-memory invites and attachment blobs", async () => {
  const relay = await startRelay({}, {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [],
    rooms: [],
    invites: [{
      id: "invite_live",
      teamId: "team-core",
      roomId: "room-desktop",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }],
    attachmentBlobs: [{
      id: "blob_expired",
      teamId: "team-core",
      roomId: "room-desktop",
      name: "expired.txt",
      type: "text/plain",
      size: 4,
      payload: {
        algorithm: "AES-GCM-256",
        nonce: "nonce-for-test",
        ciphertext: "ciphertext-for-test"
      },
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    }],
    encryptedBacklog: []
  });
  try {
    const debug = await debugRelayState(relay.baseUrl);
    assert.equal(debug.invites, 1);
    assert.equal(debug.attachmentBlobs, 0);
  } finally {
    await relay.close();
  }
});

test("relay restores persisted team member counts", async () => {
  const relay = await startRelay({}, {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [{ id: "team-core", name: "Core Team", members: 1 }],
    rooms: [],
    invites: [],
    teamMembers: [{ teamId: "team-core", userIds: ["github:first", "github:second", "github:third"] }],
    encryptedBacklog: []
  });
  try {
    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = await response.json() as { teams: Array<{ id: string; members: number }> };
    assert.equal(body.teams.find((team) => team.id === "team-core")?.members, 3);
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
    const body = await response.json() as { teams: unknown[]; rooms: unknown[] };
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
  await writeFile(dataPath, `${JSON.stringify({ version: 99, teams: [], rooms: [], invites: [], encryptedBacklog: [] })}\n`, "utf8");
  const relay = await startRelay({ MULTAIPLAYER_RELAY_SEED_DEMO: "false" }, undefined, dataPath);
  try {
    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = await response.json() as { teams: unknown[]; rooms: unknown[] };
    assert.deepEqual(body.teams, []);
    assert.deepEqual(body.rooms, []);
    const files = await readdir(tempDir);
    assert.ok(files.some((file) => /^relay-store\.json\.corrupt-unsupported-version-/.test(file)));
  } finally {
    await relay.close();
  }
});

test("relay disables debug endpoints in production unless explicitly enabled", async () => {
  const productionRelay = await startRelay({ NODE_ENV: "production" });
  try {
    const disabled = await fetch(`${productionRelay.baseUrl}/debug/rooms`);
    assert.equal(disabled.status, 404);
  } finally {
    await productionRelay.close();
  }

  const debugRelay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_DEBUG: "true"
  });
  try {
    const enabled = await fetch(`${debugRelay.baseUrl}/debug/rooms`);
    assert.equal(enabled.status, 200);
  } finally {
    await debugRelay.close();
  }
});

test("relay requires auth in production by default even without GitHub OAuth configured", async () => {
  const relay = await startRelay({ NODE_ENV: "production" });
  try {
    const config = await fetch(`${relay.baseUrl}/auth/config`);
    assert.equal(config.status, 200);
    const configBody = await config.json() as { configured: boolean; mutationsRequireAuth: boolean };
    assert.equal(configBody.configured, false);
    assert.equal(configBody.mutationsRequireAuth, true);

    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 401);
  } finally {
    await relay.close();
  }
});

test("relay does not seed demo workspace in production by default when auth is explicitly disabled", async () => {
  const relay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "false"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = await response.json() as { teams: unknown[]; rooms: unknown[] };
    assert.deepEqual(body.teams, []);
    assert.deepEqual(body.rooms, []);
  } finally {
    await relay.close();
  }
});

test("relay can explicitly seed demo workspace in production", async () => {
  const relay = await startRelay({
    NODE_ENV: "production",
    MULTAIPLAYER_RELAY_SEED_DEMO: "true",
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "false"
  });
  try {
    const response = await fetch(`${relay.baseUrl}/teams`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      teams: Array<{ id: string }>;
      rooms: Array<{ id: string }>;
    };
    assert.ok(body.teams.some((team) => team.id === "team-core"));
    assert.ok(body.rooms.some((room) => room.id === "room-desktop"));
  } finally {
    await relay.close();
  }
});

async function startRelay(
  extraEnv: NodeJS.ProcessEnv = {},
  storedState?: StoredRelayStateFixture,
  existingDataPath?: string
): Promise<RelayHarness> {
  const port = await getFreePort();
  const tempDir = existingDataPath ? resolve(existingDataPath, "..") : await mkdtemp(join(tmpdir(), "multaiplayer-relay-test-"));
  const dataPath = existingDataPath ?? join(tempDir, "relay-store.json");
  if (storedState) {
    await writeFile(dataPath, `${JSON.stringify(storedState, null, 2)}\n`, "utf8");
  }
  const bin = resolve("../../node_modules/.bin/tsx");
  const child = spawn(bin, ["src/server.ts"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      ...extraEnv,
      PORT: String(port),
      MULTAIPLAYER_RELAY_DATA_PATH: dataPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(baseUrl, child, () => output);
  } catch (error) {
    child.kill("SIGTERM");
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    baseUrl,
    wsUrl: `ws://127.0.0.1:${port}/rooms`,
    dataPath,
    tempDir,
    async close(options = {}) {
      await stopProcess(child);
      if (!options.preserveData) await rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function patchHostStatus(
  baseUrl: string,
  body: { host: string; hostUserId: string; hostStatus: "active" | "handoff" | "offline" }
): Promise<number> {
  const response = await fetch(`${baseUrl}/rooms/room-desktop/host`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  await response.text();
  return response.status;
}

async function patchRoomSettings(
  baseUrl: string,
  body: { requesterName: string; requesterUserId: string; codexModel?: string; projectPath?: string }
): Promise<number> {
  const response = await fetch(`${baseUrl}/rooms/room-desktop/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  await response.text();
  return response.status;
}

async function postJsonStatus(baseUrl: string, path: string, body: unknown): Promise<number> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  await response.text();
  return response.status;
}

async function createDebugSession(baseUrl: string, id: string, login: string, ttlMs?: number): Promise<string> {
  const response = await fetch(`${baseUrl}/debug/auth-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, login, name: login, ttlMs })
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0] ?? cookie;
}

async function debugBacklog(baseUrl: string): Promise<Array<{
  key: string;
  envelopes: number;
  sample?: {
    id: string;
    kind: string;
    payloadAlgorithm: string;
  };
}>> {
  const response = await fetch(`${baseUrl}/debug/rooms`);
  assert.equal(response.status, 200);
  const body = await response.json() as {
    rooms: Array<{
      key: string;
      envelopes: number;
      sample?: {
        id: string;
        kind: string;
        payloadAlgorithm: string;
      };
    }>;
  };
  return body.rooms;
}

async function debugRelayState(baseUrl: string): Promise<{
  invites: number;
  attachmentBlobs: number;
}> {
  const response = await fetch(`${baseUrl}/debug/rooms`);
  assert.equal(response.status, 200);
  const body = await response.json() as {
    invites?: number;
    attachmentBlobs?: number;
  };
  return {
    invites: body.invites ?? 0,
    attachmentBlobs: body.attachmentBlobs ?? 0
  };
}

async function waitForStoredState(
  dataPath: string,
  predicate: (state: StoredRelayStateFixture) => boolean
): Promise<StoredRelayStateFixture> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const state = JSON.parse(await readFile(dataPath, "utf8")) as StoredRelayStateFixture;
      if (predicate(state)) return state;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  assert.fail(`Timed out waiting for stored relay state: ${String(lastError)}`);
}

async function waitForDebugBacklog(baseUrl: string, envelopes: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const backlog = await debugBacklog(baseUrl);
    if (backlog.some((room) => room.envelopes === envelopes)) return;
    await delay(50);
  }
  assert.fail(`Timed out waiting for debug backlog with ${envelopes} envelope(s)`);
}

async function waitForReady(
  baseUrl: string,
  child: ChildProcessWithoutNullStreams,
  getOutput: () => string
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Relay exited before ready: ${getOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Keep polling until the child binds its port.
    }
    await delay(100);
  }
  throw new Error(`Relay did not become ready: ${getOutput()}`);
}

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.once("open", () => resolveOpen());
    socket.once("error", rejectOpen);
  });
}

function waitForRejectedOpen(socket: WebSocket): Promise<string> {
  return new Promise((resolveReject, rejectReject) => {
    const timer = setTimeout(() => rejectReject(new Error("Timed out waiting for WebSocket rejection")), 5_000);
    socket.once("open", () => {
      clearTimeout(timer);
      rejectReject(new Error("WebSocket unexpectedly opened"));
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      resolveReject(error.message);
    });
  });
}

function waitForRoomUpdated(socket: WebSocket): Promise<{
  id: string;
  teamId: string;
  name: string;
  codexModel: string;
}> {
  return new Promise((resolveUpdate, rejectUpdate) => {
    const timer = setTimeout(() => rejectUpdate(new Error("Timed out waiting for room.updated")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type: string;
        room?: { id: string; teamId: string; name: string; codexModel: string };
      };
      if (message.type === "room.updated" && message.room) {
        clearTimeout(timer);
        resolveUpdate(message.room);
      }
    });
    socket.once("error", rejectUpdate);
  });
}

function waitForTeamUpdated(socket: WebSocket): Promise<{
  id: string;
  name: string;
  members: number;
}> {
  return new Promise((resolveUpdate, rejectUpdate) => {
    const timer = setTimeout(() => rejectUpdate(new Error("Timed out waiting for team.updated")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type: string;
        team?: { id: string; name: string; members: number };
      };
      if (message.type === "team.updated" && message.team) {
        clearTimeout(timer);
        resolveUpdate(message.team);
      }
    });
    socket.once("error", rejectUpdate);
  });
}

function waitForJoined(socket: WebSocket): Promise<void> {
  return new Promise((resolveJoin, rejectJoin) => {
    const timer = setTimeout(() => rejectJoin(new Error("Timed out waiting for joined")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string };
      if (message.type === "joined") {
        clearTimeout(timer);
        resolveJoin();
      }
    });
    socket.once("error", rejectJoin);
  });
}

function waitForPresence(socket: WebSocket): Promise<{
  userId: string;
  deviceId: string;
  publicKeyFingerprint?: string;
  status: string;
}> {
  return new Promise((resolvePresence, rejectPresence) => {
    const timer = setTimeout(() => rejectPresence(new Error("Timed out waiting for presence")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type: string;
        userId?: string;
        deviceId?: string;
        publicKeyFingerprint?: string;
        status?: string;
      };
      if (message.type === "presence" && message.userId && message.deviceId && message.status) {
        clearTimeout(timer);
        resolvePresence({
          userId: message.userId,
          deviceId: message.deviceId,
          publicKeyFingerprint: message.publicKeyFingerprint,
          status: message.status
        });
      }
    });
    socket.once("error", rejectPresence);
  });
}

function waitForEnvelope(socket: WebSocket, kind: string, timeoutMs = 5_000): Promise<{ id: string; kind: string }> {
  return new Promise((resolveEnvelope, rejectEnvelope) => {
    const timer = setTimeout(() => rejectEnvelope(new Error(`Timed out waiting for envelope ${kind}`)), timeoutMs);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type: string;
        envelope?: { id: string; kind: string };
      };
      if (message.type === "envelope" && message.envelope?.kind === kind) {
        clearTimeout(timer);
        resolveEnvelope(message.envelope);
      }
    });
    socket.once("error", rejectEnvelope);
  });
}

function waitForError(socket: WebSocket): Promise<string> {
  return new Promise((resolveError, rejectError) => {
    const timer = setTimeout(() => rejectError(new Error("Timed out waiting for relay error")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; message?: string };
      if (message.type === "error" && message.message) {
        clearTimeout(timer);
        resolveError(message.message);
      }
    });
    socket.once("error", rejectError);
  });
}

function testEnvelope(overrides: Partial<{
  id: string;
  senderDeviceId: string;
  senderUserId: string;
  teamId: string;
  roomId: string;
  createdAt: string;
  kind: "browser.event" | "terminal.event" | "git.event" | "room.invite";
  payload: Record<string, unknown>;
}> = {}) {
  return {
    id: overrides.id ?? `envelope-${randomUUID()}`,
    teamId: overrides.teamId ?? "team-core",
    roomId: overrides.roomId ?? "room-desktop",
    senderDeviceId: overrides.senderDeviceId ?? "device-test-123",
    senderUserId: overrides.senderUserId ?? "github:tester",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    kind: overrides.kind ?? "browser.event",
    payload: overrides.payload ?? {
      algorithm: "AES-GCM-256",
      nonce: "test-nonce",
      ciphertext: "test-ciphertext"
    }
  };
}

function deviceSealedPayload() {
  return {
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
    ephemeralPublicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: "test-x",
      y: "test-y"
    },
    nonce: "test-nonce",
    ciphertext: "test-ciphertext"
  };
}

async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    delay(2_000).then(() => {
      child.kill("SIGKILL");
    })
  ]);
}

async function getFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) {
          resolvePort(address.port);
        } else {
          rejectPort(new Error("Could not allocate a free port"));
        }
      });
    });
  });
}
