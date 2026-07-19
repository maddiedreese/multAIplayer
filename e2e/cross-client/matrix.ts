import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  ChatPlaintextPayload,
  CodexActivityPlaintextPayload,
  CodexEventPlaintextPayload,
  CodexQueuePlaintextPayload
} from "@multaiplayer/protocol";
import { handleCodexQueueEvent } from "../../apps/desktop/src/hooks/relay/routeActivityMessage.js";
import { useCodexTurnActions } from "../../apps/desktop/src/hooks/useCodexTurnActions.js";
import { useAppStore } from "../../apps/desktop/src/store/appStore.js";
import {
  WebSocket,
  createDebugSession,
  onceOpen,
  startRelayWithWorkspace,
  waitForJoined,
  type StoredRelayStateFixture
} from "../../apps/relay/test/support/relay.js";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const desktopManifest = join(root, "apps/desktop/src-tauri/Cargo.toml");
const desktopBinary = join(root, "apps/desktop/src-tauri/target/debug/mls-integration-client");
const cliBinary = process.env.MULTAIPLAYER_CLI_INTEROP_BINARY;
const timeoutMs = 15_000;

type ClientKind = "cli" | "desktop";

interface DeviceIdentity {
  userId: string;
  deviceId: string;
  displayName: string;
  signaturePublicKey: string;
  signatureKeyFingerprint: string;
  hpkePublicKey: string;
  hpkeKeyFingerprint: string;
}

interface NativeResponse {
  ok: boolean;
  value?: unknown;
  error?: string;
}

class NativeClient {
  readonly kind: ClientKind;
  readonly identity: DeviceIdentity;
  readonly stateDir: string | null;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #lines: Interface;
  readonly #responses: Array<(response: NativeResponse) => void> = [];
  #errorOutput = "";

  private constructor(
    kind: ClientKind,
    child: ChildProcessWithoutNullStreams,
    lines: Interface,
    identity: DeviceIdentity,
    stateDir: string | null
  ) {
    this.kind = kind;
    this.#child = child;
    this.#lines = lines;
    this.identity = identity;
    this.stateDir = stateDir;
    child.stderr.on("data", (chunk) => (this.#errorOutput += chunk.toString()));
    lines.on("line", (line) => this.#responses.shift()?.(JSON.parse(line) as NativeResponse));
  }

  static async start(
    kind: ClientKind,
    userId: string,
    displayName: string,
    roomId: string,
    stateRoot: string,
    existingStateDir?: string
  ): Promise<NativeClient> {
    const stateDir = kind === "cli" ? (existingStateDir ?? join(stateRoot, `cli-${randomUUID()}`)) : null;
    const args =
      kind === "cli"
        ? [userId, displayName, roomId, stateDir as string]
        : [userId, `device-desktop-${randomUUID()}`, roomId];
    const child = spawn(kind === "cli" ? requireCliBinary() : desktopBinary, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const lines = createInterface({ input: child.stdout });
    const identity = await new Promise<DeviceIdentity>((resolveIdentity, reject) => {
      const timer = setTimeout(() => reject(new Error(`${kind} client did not initialize`)), timeoutMs);
      lines.once("line", (line) => {
        clearTimeout(timer);
        const response = JSON.parse(line) as NativeResponse & DeviceIdentity;
        if (!response.ok) reject(new Error(response.error ?? `${kind} client initialization failed`));
        else resolveIdentity({ ...response, displayName });
      });
      child.once("error", reject);
    });
    return new NativeClient(kind, child, lines, identity, stateDir);
  }

  command<T>(command: Record<string, unknown>): Promise<T> {
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${this.kind} command timed out: ${String(command.command)}`)),
        timeoutMs
      );
      this.#responses.push((response) => {
        clearTimeout(timer);
        if (response.ok) resolveCommand(response.value as T);
        else reject(new Error(`${this.kind} ${String(command.command)}: ${response.error ?? "failed"}`));
      });
      this.#child.stdin.write(`${JSON.stringify(command)}\n`);
    });
  }

  async close() {
    this.#child.stdin.end();
    await new Promise<void>((resolveClose, reject) => {
      const timer = setTimeout(() => {
        this.#child.kill("SIGKILL");
        reject(new Error(`${this.kind} client did not exit`));
      }, timeoutMs);
      this.#child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolveClose();
        else reject(new Error(`${this.kind} client exited ${code}: ${this.#errorOutput}`));
      });
    });
    this.#lines.close();
  }
}

function requireCliBinary() {
  if (!cliBinary) throw new Error("MULTAIPLAYER_CLI_INTEROP_BINARY is required");
  return cliBinary;
}

function workspace(host: DeviceIdentity, guest: DeviceIdentity): StoredRelayStateFixture {
  const joinedAt = "2026-07-19T12:00:00.000Z";
  return {
    version: 1,
    savedAt: joinedAt,
    teams: [{ id: "team-core", name: "Cross-client team", members: 2 }],
    rooms: [],
    invites: [],
    teamMembers: [
      {
        teamId: "team-core",
        members: [
          { teamId: "team-core", userId: host.userId, role: "owner", joinedAt },
          { teamId: "team-core", userId: guest.userId, role: "member", joinedAt }
        ]
      }
    ],
    devices: [host, guest].map((identity) => ({
      userId: identity.userId,
      deviceId: identity.deviceId,
      displayName: identity.displayName,
      signaturePublicKey: identity.signaturePublicKey,
      signatureKeyFingerprint: identity.signatureKeyFingerprint,
      hpkePublicKey: identity.hpkePublicKey,
      hpkeKeyFingerprint: identity.hpkeKeyFingerprint,
      registeredAt: joinedAt,
      lastSeenAt: joinedAt
    })),
    inviteRequests: [],
    inviteResponses: [],
    mlsBacklog: [],
    encryptedBacklog: []
  };
}

async function authenticate(baseUrl: string, client: NativeClient) {
  const cookie = await createDebugSession(baseUrl, client.identity.userId, client.identity.displayName);
  const challengeResponse = await fetch(`${baseUrl}/devices/${client.identity.deviceId}/challenge`, {
    method: "POST",
    headers: { cookie }
  });
  assert.equal(challengeResponse.status, 200);
  const { challenge } = (await challengeResponse.json()) as { challenge: string };
  const signed = await client.command<{ signature: string }>({ command: "signChallenge", challenge });
  const sessionResponse = await fetch(`${baseUrl}/devices/${client.identity.deviceId}/session`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ challenge, signature: signed.signature })
  });
  assert.equal(sessionResponse.status, 200);
  const { deviceSessionToken } = (await sessionResponse.json()) as { deviceSessionToken: string };
  return {
    cookie,
    token: deviceSessionToken,
    headers: { "content-type": "application/json", cookie, "x-device-session": deviceSessionToken }
  };
}

function waitForMessage(socket: WebSocket, predicate: (message: Record<string, unknown>) => boolean) {
  return new Promise<Record<string, unknown>>((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for relay message")), timeoutMs);
    const listener = (raw: Buffer) => {
      const value = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off("message", listener);
      resolveMessage(value);
    };
    socket.on("message", listener);
  });
}

async function joinRoom(socket: WebSocket, client: NativeClient, token: string, roomId: string) {
  const joined = waitForJoined(socket);
  socket.send(
    JSON.stringify({
      type: "join",
      teamId: "team-core",
      roomId,
      userId: client.identity.userId,
      deviceId: client.identity.deviceId,
      deviceSessionToken: token
    })
  );
  await joined;
}

async function publish(socket: WebSocket, message: Record<string, unknown>) {
  const messageId = String(message.id);
  const acknowledged = waitForMessage(socket, (value) => value.type === "published" && value.messageId === messageId);
  socket.send(JSON.stringify({ type: "publish", message }));
  await acknowledged;
}

function mlsMessage(value: Record<string, unknown>) {
  assert.equal(value.type, "mls.message");
  return value.message as { id: string; mlsMessage: string };
}

function normalizeOpened(value: unknown): {
  payload: unknown;
  authenticatedData: Record<string, unknown>;
  unsupportedRendering?: string | null;
} {
  const opened = value as {
    payload: unknown;
    authenticatedData: unknown;
    unsupportedRendering?: string | null;
  };
  if (typeof opened.authenticatedData === "string") {
    return {
      payload: JSON.parse(String(opened.payload)),
      authenticatedData: JSON.parse(Buffer.from(opened.authenticatedData, "base64").toString("utf8"))
    };
  }
  return {
    payload: opened.payload,
    authenticatedData: opened.authenticatedData as Record<string, unknown>,
    unsupportedRendering: opened.unsupportedRendering
  };
}

async function sendApplication(options: {
  sender: NativeClient;
  senderSocket: WebSocket;
  receiver: NativeClient;
  receiverSocket: WebSocket;
  roomId: string;
  kind: string;
  payload: unknown;
  id: string;
}) {
  const createdAt = new Date().toISOString();
  const encrypted = await options.sender.command<{ message: string; messageId: string; epoch: number }>({
    command: "encrypt",
    messageId: options.id,
    payload: JSON.stringify(options.payload),
    authenticatedData: {
      version: 1,
      messageId: options.id,
      teamId: "team-core",
      roomId: options.roomId,
      kind: options.kind,
      senderUserId: options.sender.identity.userId,
      senderDeviceId: options.sender.identity.deviceId,
      createdAt
    }
  });
  const delivered = waitForMessage(
    options.receiverSocket,
    (value) => value.type === "mls.message" && (value.message as { id?: string })?.id === options.id
  );
  await publish(options.senderSocket, {
    id: options.id,
    teamId: "team-core",
    roomId: options.roomId,
    senderUserId: options.sender.identity.userId,
    senderDeviceId: options.sender.identity.deviceId,
    createdAt,
    messageType: "application",
    epochHint: encrypted.epoch,
    mlsMessage: encrypted.message
  });
  await options.sender.command({ command: "publishSucceeded", messageId: encrypted.messageId });
  const envelope = mlsMessage(await delivered);
  const opened = normalizeOpened(await options.receiver.command({ command: "process", message: envelope.mlsMessage }));
  assert.equal(opened.authenticatedData.messageId, options.id);
  assert.equal(opened.authenticatedData.kind, options.kind);
  return opened;
}

async function createAndActivateRoom(
  baseUrl: string,
  host: NativeClient,
  hostAuth: Awaited<ReturnType<typeof authenticate>>,
  hostSocket: WebSocket,
  label: string
) {
  const created = await fetch(`${baseUrl}/rooms`, {
    method: "POST",
    headers: hostAuth.headers,
    body: JSON.stringify({ teamId: "team-core", name: label, approvalPolicy: "ask_every_turn" })
  });
  assert.equal(created.status, 201);
  const { room } = (await created.json()) as {
    room: Record<string, unknown> & { id: string; hostUserId: string; hostStatus: string };
  };
  assert.equal(room.hostUserId, host.identity.userId);
  assert.equal(room.hostStatus, "offline");
  await host.command({ command: "setRoom", roomId: room.id });
  await host.command({ command: "createGroup" });
  await joinRoom(hostSocket, host, hostAuth.token, room.id);
  const activated = await fetch(`${baseUrl}/rooms/${room.id}/host`, {
    method: "PATCH",
    headers: hostAuth.headers,
    body: JSON.stringify({
      host: host.identity.displayName,
      hostUserId: host.identity.userId,
      hostDeviceId: host.identity.deviceId,
      hostStatus: "active"
    })
  });
  assert.equal(activated.status, 200);
  const body = (await activated.json()) as { room: Record<string, unknown> & { id: string } };
  return body.room;
}

async function runJourney(hostKind: ClientKind, guestKind: ClientKind) {
  const stateRoot = await mkdtemp(join(tmpdir(), "multaiplayer-cross-client-"));
  const provisionalRoomId = `room-cross-${randomUUID()}`;
  const host = await NativeClient.start(
    hostKind,
    `github:${hostKind}-host-${randomUUID()}`,
    `${hostKind} host`,
    provisionalRoomId,
    stateRoot
  );
  let guest = await NativeClient.start(
    guestKind,
    `github:${guestKind}-guest-${randomUUID()}`,
    `${guestKind} guest`,
    provisionalRoomId,
    stateRoot
  );
  const relay = await startRelayWithWorkspace({}, workspace(host.identity, guest.identity));
  const hostSocket = new WebSocket(relay.wsUrl);
  let guestSocket = new WebSocket(relay.wsUrl);
  try {
    await Promise.all([onceOpen(hostSocket), onceOpen(guestSocket)]);
    const [hostAuth, guestAuth] = await Promise.all([
      authenticate(relay.baseUrl, host),
      authenticate(relay.baseUrl, guest)
    ]);
    const activeRoom = await createAndActivateRoom(
      relay.baseUrl,
      host,
      hostAuth,
      hostSocket,
      `${hostKind}-created cross-client room`
    );
    const roomId = activeRoom.id;
    await guest.command({ command: "setRoom", roomId });

    const cli = host.kind === "cli" ? host : guest;
    await assert.rejects(
      cli.command({
        command: "validateHostRole",
        createdAsHost: host.kind === "cli",
        isActiveHost: host.kind !== "cli"
      }),
      /Host handoff is not supported by this CLI version/
    );

    const keyPackage = await guest.command<{ keyPackage: string }>({ command: "generateKeyPackage" });
    const admission = await host.command<{
      commit: string;
      commitOutboxId: string;
      parentEpoch: number;
      welcome: string;
    }>({ command: "addMember", keyPackage: keyPackage.keyPackage });
    await publish(hostSocket, {
      id: admission.commitOutboxId,
      teamId: "team-core",
      roomId,
      senderUserId: host.identity.userId,
      senderDeviceId: host.identity.deviceId,
      createdAt: new Date().toISOString(),
      messageType: "commit",
      epochHint: admission.parentEpoch,
      mlsMessage: admission.commit
    });
    await host.command({ command: "publishSucceeded", messageId: admission.commitOutboxId });
    await guest.command({ command: "joinWelcome", welcome: admission.welcome });
    await joinRoom(guestSocket, guest, guestAuth.token, roomId);

    if (guest.kind === "cli") {
      const relayOrigin = "https://cross-client.invalid";
      await guest.command({ command: "recordCompletedAdmission", relayOrigin, room: activeRoom });
      const priorIdentity = guest.identity;
      const stateDir = guest.stateDir;
      assert.ok(stateDir);
      await guest.close();
      guest = await NativeClient.start(
        "cli",
        priorIdentity.userId,
        priorIdentity.displayName,
        roomId,
        stateRoot,
        stateDir
      );
      assert.equal(guest.identity.deviceId, priorIdentity.deviceId);
      const opened = await guest.command<{
        roomId: string;
        isActiveHost: boolean;
        projectPath: string | null;
      }>({ command: "openJoinedRoom", relayOrigin, room: activeRoom });
      assert.deepEqual(opened, { roomId, isActiveHost: false, projectPath: null });
    }

    const hostChat = {
      id: `chat-${randomUUID()}`,
      author: host.identity.displayName,
      authorUserId: host.identity.userId,
      role: "human",
      body: `chat from ${hostKind}`,
      time: "12:00 PM",
      createdAt: new Date().toISOString()
    };
    const hostChatOpened = await sendApplication({
      sender: host,
      senderSocket: hostSocket,
      receiver: guest,
      receiverSocket: guestSocket,
      roomId,
      kind: "chat.message",
      payload: hostChat,
      id: hostChat.id
    });
    assert.deepEqual(ChatPlaintextPayload.parse(hostChatOpened.payload), hostChat);

    const guestChat = {
      id: `chat-${randomUUID()}`,
      author: guest.identity.displayName,
      authorUserId: guest.identity.userId,
      role: "human",
      body: `chat from ${guestKind}`,
      time: "12:01 PM",
      createdAt: new Date().toISOString()
    };
    const guestChatOpened = await sendApplication({
      sender: guest,
      senderSocket: guestSocket,
      receiver: host,
      receiverSocket: hostSocket,
      roomId,
      kind: "chat.message",
      payload: guestChat,
      id: guestChat.id
    });
    assert.deepEqual(ChatPlaintextPayload.parse(guestChatOpened.payload), guestChat);

    const proposal = {
      eventType: "codex.queue",
      queueEventId: `queue-${randomUUID()}`,
      turnId: `turn-${randomUUID()}`,
      action: "queued",
      requestedBy: guest.identity.displayName,
      requestedByUserId: guest.identity.userId,
      reason: "Review the mixed-client journey",
      queuePosition: 1,
      queueSize: 1,
      createdAt: new Date().toISOString()
    } as const;
    const proposalOpened = await sendApplication({
      sender: guest,
      senderSocket: guestSocket,
      receiver: host,
      receiverSocket: hostSocket,
      roomId,
      kind: "codex.queue",
      payload: proposal,
      id: proposal.queueEventId
    });
    const parsedProposal = CodexQueuePlaintextPayload.parse(proposalOpened.payload);
    if (host.kind === "cli") {
      const approval = await host.command<{ phase: string }>({
        command: "approveProposal",
        proposal: parsedProposal,
        nowUnix: Math.floor(Date.now() / 1_000)
      });
      assert.equal(approval.phase, "Running");
      const turn = {
        eventType: "codex.turn",
        turnId: proposal.turnId,
        status: "completed",
        message: "Mixed-client CLI host turn completed.",
        model: "gpt-5.6-sol",
        threadId: `thread-${randomUUID()}`,
        eventName: "hosted_turn_completed",
        host: host.identity.displayName,
        hostUserId: host.identity.userId,
        createdAt: new Date().toISOString()
      } as const;
      const turnOpened = await sendApplication({
        sender: host,
        senderSocket: hostSocket,
        receiver: guest,
        receiverSocket: guestSocket,
        roomId,
        kind: "codex.turn",
        payload: turn,
        id: `turn-event-${randomUUID()}`
      });
      assert.deepEqual(CodexEventPlaintextPayload.parse(turnOpened.payload), turn);
    } else {
      const desktopRoom = {
        ...activeRoom,
        projectPath: stateRoot,
        unread: 0,
        configPending: false
      };
      useAppStore.getState().resetAppStore();
      useAppStore.setState({
        rooms: [desktopRoom],
        selectedRoomId: roomId,
        messagesByRoom: { [roomId]: [guestChat] }
      } as never);
      handleCodexQueueEvent(parsedProposal, roomId, useAppStore.getState());
      const queued = useAppStore
        .getState()
        .codexRuntimeByRoom[roomId]?.queuedApprovals?.find((item) => item.turnId === proposal.turnId);
      assert.ok(queued);
      assert.equal(queued.roomId, roomId);
      assert.equal(queued.requestedByUserId, guest.identity.userId);

      const publishedTurns: Array<ReturnType<typeof CodexEventPlaintextPayload.parse>> = [];
      const actions = useCodexTurnActions({
        localUser: { id: host.identity.userId, name: host.identity.displayName },
        maxTerminalActivityLines: 100,
        replaceRoom: () => undefined,
        publishCodexEvent: async (event, boundRoom) => {
          assert.equal(boundRoom?.id, roomId);
          assert.equal(boundRoom?.hostUserId, host.identity.userId);
          assert.equal(boundRoom?.activeHostDeviceId, host.identity.deviceId);
          const payload = {
            ...event,
            eventType: "codex.turn",
            host: host.identity.displayName,
            hostUserId: host.identity.userId,
            createdAt: new Date().toISOString()
          };
          const opened = await sendApplication({
            sender: host,
            senderSocket: hostSocket,
            receiver: guest,
            receiverSocket: guestSocket,
            roomId,
            kind: "codex.turn",
            payload,
            id: `desktop-approval-${randomUUID()}`
          });
          assert.equal(opened.authenticatedData.senderUserId, host.identity.userId);
          assert.equal(opened.authenticatedData.senderDeviceId, host.identity.deviceId);
          publishedTurns.push(CodexEventPlaintextPayload.parse(opened.payload));
        },
        publishChatMessage: async () => undefined,
        publishHostHandoff: async () => undefined
      });
      await actions.approveCodexTurn(queued as never);
      assert.equal(publishedTurns[0]?.status, "started");
      assert.equal(publishedTurns[0]?.turnId, proposal.turnId);
      assert.equal(publishedTurns[0]?.hostUserId, host.identity.userId);
      assert.ok(publishedTurns.some((event) => event.status === "failed"));
      assert.equal(useAppStore.getState().codexRuntimeByRoom[roomId]?.running, undefined);
      assert.ok(
        !useAppStore
          .getState()
          .codexRuntimeByRoom[roomId]?.queuedApprovals?.some((item) => item.turnId === proposal.turnId)
      );
    }

    const activity = {
      eventType: "codex.activity",
      activityId: `activity-${randomUUID()}`,
      turnId: proposal.turnId,
      itemId: `item-${randomUUID()}`,
      kind: "reasoning",
      status: "completed",
      title: "Reviewed interoperability",
      details: { type: "reasoning", summaries: ["Mixed clients share the bounded projection."] },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      host: host.identity.displayName,
      hostUserId: host.identity.userId
    } as const;
    const activityOpened = await sendApplication({
      sender: host,
      senderSocket: hostSocket,
      receiver: guest,
      receiverSocket: guestSocket,
      roomId,
      kind: "codex.activity",
      payload: activity,
      id: activity.activityId
    });
    assert.deepEqual(CodexActivityPlaintextPayload.parse(activityOpened.payload), activity);

    if (host.kind === "desktop" || guest.kind === "desktop") {
      const desktop = host.kind === "desktop" ? host : guest;
      const desktopSocket = host.kind === "desktop" ? hostSocket : guestSocket;
      const cli = host.kind === "cli" ? host : guest;
      const cliSocket = host.kind === "cli" ? hostSocket : guestSocket;
      const unsupported = await sendApplication({
        sender: desktop,
        senderSocket: desktopSocket,
        receiver: cli,
        receiverSocket: cliSocket,
        roomId,
        kind: "future.desktop.event",
        payload: { secret: "MUST-NOT-RENDER\u001b[2J", nested: { localPath: "/private/host" } },
        id: `unsupported-${randomUUID()}`
      });
      assert.equal(unsupported.unsupportedRendering, "[unsupported] event: future.desktop.event");
      assert.ok(!unsupported.unsupportedRendering?.includes("MUST-NOT-RENDER"));
      assert.ok(!unsupported.unsupportedRendering?.includes("\u001b"));
    }

    guestSocket.close();
    const delayed = {
      id: `replay-${randomUUID()}`,
      author: host.identity.displayName,
      authorUserId: host.identity.userId,
      role: "human",
      body: "replayed after mixed-client reconnect",
      time: "12:02 PM",
      createdAt: new Date().toISOString()
    };
    const encrypted = await host.command<{ message: string; messageId: string; epoch: number }>({
      command: "encrypt",
      messageId: delayed.id,
      payload: JSON.stringify(delayed),
      authenticatedData: {
        version: 1,
        messageId: delayed.id,
        teamId: "team-core",
        roomId,
        kind: "chat.message",
        senderUserId: host.identity.userId,
        senderDeviceId: host.identity.deviceId,
        createdAt: delayed.createdAt
      }
    });
    await publish(hostSocket, {
      id: delayed.id,
      teamId: "team-core",
      roomId,
      senderUserId: host.identity.userId,
      senderDeviceId: host.identity.deviceId,
      createdAt: delayed.createdAt,
      messageType: "application",
      epochHint: encrypted.epoch,
      mlsMessage: encrypted.message
    });
    await host.command({ command: "publishSucceeded", messageId: encrypted.messageId });
    guestSocket = new WebSocket(relay.wsUrl);
    await onceOpen(guestSocket);
    const replayed = waitForMessage(
      guestSocket,
      (value) => value.type === "mls.message" && (value.message as { id?: string })?.id === delayed.id
    );
    await joinRoom(guestSocket, guest, guestAuth.token, roomId);
    const replayOpened = normalizeOpened(
      await guest.command({ command: "process", message: mlsMessage(await replayed).mlsMessage })
    );
    assert.deepEqual(ChatPlaintextPayload.parse(replayOpened.payload), delayed);

    const removed = waitForMessage(
      guestSocket,
      (value) => value.type === "error" && value.code === "membership_removed"
    );
    const removal = await fetch(
      `${relay.baseUrl}/teams/team-core/members/${encodeURIComponent(guest.identity.userId)}`,
      { method: "DELETE", headers: hostAuth.headers }
    );
    assert.equal(removal.status, 200);
    await removed;
  } finally {
    useAppStore.getState().resetAppStore();
    hostSocket.close();
    guestSocket.close();
    await Promise.allSettled([host.close(), guest.close()]);
    await relay.close();
    await rm(stateRoot, { recursive: true, force: true });
  }
}

async function main() {
  requireCliBinary();
  await execFileAsync(
    "cargo",
    [
      "build",
      "--quiet",
      "--locked",
      "--manifest-path",
      desktopManifest,
      "-p",
      "mls-core",
      "--features",
      "test-fixtures",
      "--bin",
      "mls-integration-client"
    ],
    { cwd: root, timeout: 240_000, maxBuffer: 2_000_000 }
  );
  await runJourney("cli", "cli");
  await runJourney("cli", "desktop");
  await runJourney("desktop", "cli");
  process.stdout.write("CLI-140 mixed-client matrix passed (CLI/CLI, CLI/desktop, desktop/CLI).\n");
}

await main();
