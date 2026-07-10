import assert from "node:assert/strict";
import test from "node:test";
import { createRoomSecret, encryptJson, type RoomSecret } from "@multaiplayer/crypto";
import type { CodexQueuePlaintextPayload, RelayEnvelope, RoomRecord } from "@multaiplayer/protocol";
import { handleCodexQueueEvent, routeRelayEnvelope } from "../src/hooks/relay/routeRelayEnvelope";
import { importRoomSecret } from "../src/lib/localHistory";
import { useAppStore } from "../src/store/appStore";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });

const roomId = "room-relay-router";
const relayRoom: RoomRecord = {
  id: roomId,
  teamId: "team-relay-router",
  name: "Relay router",
  projectPath: "/tmp/project",
  host: "Peer",
  hostUserId: "github:peer",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  unread: 0
};
let roomSecret: RoomSecret;

test.beforeEach(async () => {
  useAppStore.getState().resetAppStore();
  localStorage.clear();
  roomSecret = await createRoomSecret();
  await importRoomSecret(roomId, roomSecret);
});

function queueEvent(
  action: CodexQueuePlaintextPayload["action"],
  overrides: Partial<CodexQueuePlaintextPayload> = {}
): CodexQueuePlaintextPayload {
  return {
    eventType: "codex.queue",
    queueEventId: `queue-${action}`,
    turnId: "turn-1",
    action,
    requestedBy: "Avery",
    requestedByUserId: "github:avery",
    queueSize: action === "queued" ? 1 : 0,
    createdAt: "2026-07-09T12:00:00.000Z",
    ...overrides
  };
}

test("Codex queue routing dispatches through one store action surface", () => {
  handleCodexQueueEvent(queueEvent("queued", { triggerMessageId: "message-1" }), "room-a", useAppStore.getState());

  let state = useAppStore.getState();
  assert.deepEqual(state.codexRuntimeByRoom["room-a"]?.queuedApprovals, [{
    roomId: "room-a",
    turnId: "turn-1",
    requestedBy: "Avery",
    requestedByUserId: "github:avery",
    queuedAt: "2026-07-09T12:00:00.000Z",
    triggerMessageId: "message-1"
  }]);
  assert.equal(state.roomSettingsByRoom["room-a"]?.hostMessage, "Avery proposed a Codex turn for host approval.");

  state.setApprovalVisibleForRoom("room-a", true);
  handleCodexQueueEvent(queueEvent("cancelled", { reason: "Requester cancelled." }), "room-a", useAppStore.getState());
  state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom["room-a"]?.queuedApprovals, undefined);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.approvalVisible, undefined);
  assert.equal(state.roomSettingsByRoom["room-a"]?.hostMessage, "Requester cancelled.");
});

test("live relay routing rejects payloads that violate protocol schemas", async () => {
  const invalidPayloads: Array<[RelayEnvelope["kind"], unknown]> = [
    ["chat.reaction", {
      id: "reaction-1", messageId: "message-1", emoji: "👍", action: "add", reactor: "Peer",
      reactorUserId: "github:peer", createdAt: "not-a-datetime"
    }],
    ["terminal.request", {
      id: "terminal-1", requester: "Peer", requesterUserId: "github:peer", command: "pwd", cwd: "/tmp",
      requestedAt: "not-a-datetime"
    }],
    ["browser.request", null],
    ["room.host", null],
    ["git.event", {
      eventType: "git.workflow", status: "completed", branch: "main", push: false, message: "Done",
      runner: "Peer", runnerUserId: "github:peer", createdAt: "not-a-datetime"
    }],
    ["room.settings", {
      eventType: "room.settings", id: "settings-1", setting: "roomName", previousValue: "Old", nextValue: "New",
      changedBy: "Peer", changedByUserId: "github:peer", changedAt: "not-a-datetime"
    }],
    ["codex.event", {
      eventType: "codex.turn", turnId: "turn-1", status: "event", message: "Working", model: "gpt-5.4",
      host: "x".repeat(10_000), hostUserId: "github:peer", createdAt: "2026-07-09T12:00:00.000Z"
    }]
  ];

  for (const [kind, payload] of invalidPayloads) {
    await assert.doesNotReject(routePayload(kind, payload));
  }

  const state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom[roomId]?.events?.length ?? 0, 0);
  assert.equal(state.terminalRequestsByRoom?.[roomId]?.length ?? 0, 0);
  assert.equal(state.browserRequestsByRoom?.[roomId]?.length ?? 0, 0);
  assert.equal(state.hostHandoffByRoom?.[roomId]?.records?.length ?? 0, 0);
  assert.equal(state.gitWorkflowRuntimeByRoom?.[roomId]?.workflow.events.length ?? 0, 0);
  assert.equal(state.messagesByRoom?.[roomId]?.length ?? 0, 0);
});

test("live routing accepts strict Codex and complete room-setting payloads", async () => {
  await routePayload("codex.event", {
    eventType: "codex.turn",
    turnId: "turn-valid",
    status: "event",
    message: "Working",
    model: "gpt-5.4",
    host: "Peer",
    hostUserId: "github:peer",
    createdAt: "2026-07-09T12:00:00.000Z"
  });
  for (const setting of ["approvalDelegationPolicy", "trustedApprovers"] as const) {
    await routePayload("room.settings", {
      eventType: "room.settings",
      id: `settings-${setting}`,
      setting,
      previousValue: "Old",
      nextValue: "New",
      changedBy: "Peer",
      changedByUserId: "github:peer",
      changedAt: "2026-07-09T12:01:00.000Z"
    });
  }

  const state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom[roomId]?.events?.[0]?.turnId, "turn-valid");
  assert.equal(state.messagesByRoom[roomId]?.length, 2);
});

test("live routing rejects room-setting notices not authored by the active host", async () => {
  const payload = {
    eventType: "room.settings",
    id: "settings-unauthorized",
    setting: "roomName",
    previousValue: "Old",
    nextValue: "Spoofed",
    changedBy: "Member",
    changedByUserId: "github:member",
    changedAt: "2026-07-09T12:01:00.000Z"
  } as const;

  await routePayload("room.settings", payload, { senderUserId: "github:member" });
  await routePayload("room.settings", payload);

  assert.equal(useAppStore.getState().messagesByRoom[roomId]?.length ?? 0, 0);
});

async function routePayload(
  kind: RelayEnvelope["kind"],
  plaintext: unknown,
  options: { senderUserId?: string; rooms?: RoomRecord[] } = {}
): Promise<void> {
  const envelope: RelayEnvelope = {
    id: crypto.randomUUID(),
    teamId: "team-relay-router",
    roomId,
    senderDeviceId: "device-peer",
    senderUserId: options.senderUserId ?? "github:peer",
    createdAt: "2026-07-09T12:00:00.000Z",
    kind,
    payload: await encryptJson(plaintext, roomSecret)
  };
  await routeRelayEnvelope(envelope, {
    deviceId: "device-local",
    localUser: { id: "github:local", name: "Local" },
    roomsRef: { current: options.rooms ?? [relayRoom] },
    selectedRoomIdRef: { current: roomId },
    historyLoadedRoomIds: { current: new Set<string>() },
    markIncomingChatUnread: () => undefined,
    decryptInviteEnvelope: async () => null,
    handleInviteEnvelopePlaintext: async () => undefined,
    handleCodexBrowserOpenCommand: () => false
  });
}
