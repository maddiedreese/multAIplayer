import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { CodexEventPlaintextPayload, RoomRecord } from "@multaiplayer/protocol";
import { createCodexInvokeActions } from "../src/lib/codexInvokeActions";
import { saveCodexFollowUpBehavior } from "../src/lib/codexFollowUpBehavior";
import { useAppStore } from "../src/store/appStore";
import type { ChatMessage } from "../src/types";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const localStorage = new MemoryStorage();
type NativeInvoke = (command: string, args?: unknown) => Promise<unknown>;
const tauriInternals: { invoke: NativeInvoke } = {
  invoke: async (command) => {
    throw new Error(`Unexpected native command: ${command}`);
  }
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: tauriInternals } });

const room: RoomRecord = {
  id: "room-steering",
  teamId: "team-steering",
  name: "Steering",
  projectPath: "/tmp/steering",
  host: "Maddie",
  hostUserId: "github:maddie",
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

const steeringMessage: ChatMessage = {
  id: "message-steer",
  author: "Maddie",
  authorUserId: "github:maddie",
  role: "system",
  body: "@Codex update the parser first",
  time: "10:00",
  createdAt: "2026-07-14T17:00:00.000Z"
};

beforeEach(() => {
  localStorage.clear();
  tauriInternals.invoke = async (command) => {
    throw new Error(`Unexpected native command: ${command}`);
  };
  useAppStore.getState().resetAppStore();
  useAppStore.setState({
    teams: [{ id: room.teamId, name: "Steering team", members: 1 }],
    rooms: [room],
    selectedTeam: room.teamId,
    selectedRoomId: room.id,
    currentUser: { id: "github:maddie", login: "maddie", name: "Maddie" }
  });
});

function actions({
  publishedEvents = [],
  publishedQueueEvents = [],
  publishEventError = null
}: {
  publishedEvents?: Array<Partial<CodexEventPlaintextPayload>>;
  publishedQueueEvents?: Array<{ action: string; turnId: string; triggerMessageId?: string }>;
  publishEventError?: Error | null;
} = {}) {
  return createCodexInvokeActions({
    selectedRoomIdRef: { current: room.id },
    publishChatMessage: async () => undefined,
    handleCodexBrowserOpenCommand: () => false,
    publishCodexQueueEvent: async (event) => {
      publishedQueueEvents.push(event);
    },
    publishCodexEvent: async (event) => {
      if (publishEventError) throw publishEventError;
      publishedEvents.push(event);
    }
  });
}

async function settleSteering() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("active hosts steer a running native turn and publish its acknowledged room event", async () => {
  const nativeCalls: Array<{ command: string; args: unknown }> = [];
  tauriInternals.invoke = async (command, args) => {
    nativeCalls.push({ command, args });
    return { threadId: "thread-1", turnId: "server-turn-1", clientTurnId: "client-turn-1" };
  };
  useAppStore.getState().setCodexRunningForRoom(room.id, true);
  const publishedEvents: Array<Partial<CodexEventPlaintextPayload>> = [];
  const publishedQueueEvents: Array<{ action: string; turnId: string }> = [];

  actions({ publishedEvents, publishedQueueEvents }).handleCodexInvoke(steeringMessage);
  await settleSteering();

  assert.deepEqual(nativeCalls, [
    {
      command: "steer_codex_turn",
      args: { request: { roomId: room.id, input: "update the parser first" } }
    }
  ]);
  assert.deepEqual(publishedEvents, [
    {
      turnId: "client-turn-1",
      status: "event",
      message: "Maddie steered the current Codex turn.",
      model: "gpt-5.4",
      threadId: "thread-1",
      eventName: "turn/steer acknowledged",
      consumedMessageIds: [steeringMessage.id]
    }
  ]);
  assert.deepEqual(publishedQueueEvents, []);
  assert.match(useAppStore.getState().roomSettingsByRoom[room.id]?.hostMessage ?? "", /accepted the steering/);
});

test("Queue next turn bypasses native steering and uses the bounded room queue", async () => {
  let nativeCallCount = 0;
  tauriInternals.invoke = async () => {
    nativeCallCount += 1;
    return null;
  };
  saveCodexFollowUpBehavior("queue");
  useAppStore.getState().setCodexRunningForRoom(room.id, true);
  const publishedQueueEvents: Array<{ action: string; turnId: string; triggerMessageId?: string }> = [];

  actions({ publishedQueueEvents }).handleCodexInvoke(steeringMessage);
  await settleSteering();

  assert.equal(nativeCallCount, 0);
  const queued = useAppStore.getState().codexRuntimeByRoom[room.id]?.queuedApprovals ?? [];
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.triggerMessageId, steeringMessage.id);
  assert.deepEqual(publishedQueueEvents, [
    {
      turnId: queued[0]?.turnId,
      action: "queued",
      triggerMessageId: steeringMessage.id,
      queuePosition: 1,
      queueSize: 1
    }
  ]);
});

test("attachments fall back to the next-turn queue instead of being lost from steering", async () => {
  let nativeCallCount = 0;
  tauriInternals.invoke = async () => {
    nativeCallCount += 1;
    return null;
  };
  useAppStore.getState().setCodexRunningForRoom(room.id, true);
  const messageWithAttachment: ChatMessage = {
    ...steeringMessage,
    id: "message-steer-attachment",
    attachments: [
      {
        id: "attachment-1",
        name: "parser.ts",
        type: "text/plain",
        size: 128,
        content: "export const parser = true;"
      }
    ]
  };
  const publishedQueueEvents: Array<{ action: string; turnId: string; triggerMessageId?: string }> = [];

  actions({ publishedQueueEvents }).handleCodexInvoke(messageWithAttachment);
  await settleSteering();

  assert.equal(nativeCallCount, 0);
  assert.equal(
    useAppStore.getState().codexRuntimeByRoom[room.id]?.queuedApprovals?.[0]?.triggerMessageId,
    messageWithAttachment.id
  );
  assert.equal(publishedQueueEvents.length, 1);
  assert.match(
    useAppStore.getState().roomSettingsByRoom[room.id]?.hostMessage ?? "",
    /Attachments cannot be added.*queued for the next turn/
  );
});

test("steering preference cannot bypass host or running-turn gates", async () => {
  let nativeCallCount = 0;
  tauriInternals.invoke = async () => {
    nativeCallCount += 1;
    return null;
  };
  useAppStore.getState().setCodexRunningForRoom(room.id, true);
  useAppStore.setState({ currentUser: { id: "github:member", login: "member", name: "Member" } });
  const memberQueueEvents: Array<{ action: string; turnId: string }> = [];
  actions({ publishedQueueEvents: memberQueueEvents }).handleCodexInvoke({
    ...steeringMessage,
    author: "Member",
    authorUserId: "github:member"
  });
  assert.equal(nativeCallCount, 0);
  assert.equal(memberQueueEvents.length, 1);

  useAppStore.getState().resetCodexApprovalForRoom(room.id);
  useAppStore.getState().setCodexRunningForRoom(room.id, false);
  useAppStore.setState({ currentUser: { id: "github:maddie", login: "maddie", name: "Maddie" } });
  const idleQueueEvents: Array<{ action: string; turnId: string }> = [];
  actions({ publishedQueueEvents: idleQueueEvents }).handleCodexInvoke(steeringMessage);
  assert.equal(nativeCallCount, 0);
  assert.equal(idleQueueEvents.length, 1);
  assert.equal(useAppStore.getState().codexRuntimeByRoom[room.id]?.approvalVisible, true);
});

test("native steering failures are fixed, non-sensitive, and tell the user how to queue", async () => {
  tauriInternals.invoke = async () => {
    throw new Error("secret native detail /Users/maddie/private");
  };
  useAppStore.getState().setCodexRunningForRoom(room.id, true);

  actions().handleCodexInvoke(steeringMessage);
  await settleSteering();

  const message = useAppStore.getState().roomSettingsByRoom[room.id]?.hostMessage ?? "";
  assert.match(message, /could not steer.*Queue next turn.*send.*again/i);
  assert.doesNotMatch(message, /secret|Users|private/);
});

test("room publication failure does not misreport an already accepted steering instruction", async () => {
  tauriInternals.invoke = async () => ({
    threadId: "thread-1",
    turnId: "server-turn-1",
    clientTurnId: "client-turn-1"
  });
  useAppStore.getState().setCodexRunningForRoom(room.id, true);

  actions({ publishEventError: new Error("secret relay detail") }).handleCodexInvoke(steeringMessage);
  await settleSteering();

  const message = useAppStore.getState().roomSettingsByRoom[room.id]?.hostMessage ?? "";
  assert.match(message, /accepted.*acknowledgement could not be shared.*Do not send/i);
  assert.doesNotMatch(message, /secret|relay detail/);
});
