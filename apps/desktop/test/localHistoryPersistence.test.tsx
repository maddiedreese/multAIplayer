import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderHook, waitFor } from "@testing-library/react";
import type { ClientRoomRecord } from "@multaiplayer/protocol";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });

const saves: unknown[] = [];
Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
  configurable: true,
  value: {
    invoke: async (command: string, args: unknown) => {
      if (command === "mls_history_save") {
        saves.push(args);
        return 0;
      }
      throw new Error(`Unexpected command ${command}`);
    }
  }
});
Object.defineProperty(dom.window, "__TAURI_INTERNALS__", {
  configurable: true,
  value: (globalThis as typeof globalThis & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__
});

const { useAppStore } = await import("../src/store/appStore");
const { flushEncryptedHistorySaves } = await import("../src/lib/history/localHistory");
const { useLocalHistoryPersistence } = await import("../src/hooks/useLocalHistoryPersistence");

const room: ClientRoomRecord = {
  id: "room-a",
  teamId: "team-a",
  name: "Room A",
  projectPath: "/tmp/room-a",
  host: "Maddie",
  hostUserId: "github:maddie",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  codexModel: "gpt-5.4",
  browserProfilePersistent: true,
  unread: 0
};

function options() {
  const state = useAppStore.getState();
  return {
    hasSelectedRoom: true,
    selectedRoomId: room.id,
    selectedRoomTeamId: room.teamId,
    selectedRoom: room,
    forgottenRoomIds: state.forgottenRoomIds,
    revokedRoomIds: state.revokedRoomIds,
    revokedTeamIds: state.revokedTeamIds,
    historySettings: { enabled: true, retentionDays: 30 },
    messages: state.messagesByRoom[room.id] ?? [],
    chatEdits: [],
    chatDeletes: [],
    terminalRequests: [],
    fileSaveRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    codexActivities: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminals: [],
    hostHandoffs: [],
    queuedCodexTurns: [],
    roomGoal: null,
    codexThreadGraph: { activeThreadId: null, nodesById: {} }
  };
}

test.beforeEach(() => {
  saves.length = 0;
  localStorage.clear();
  localStorage.setItem("multaiplayer:history-settings:room-a", JSON.stringify({ enabled: true, retentionDays: 30 }));
  const store = useAppStore.getState();
  store.resetAppStore();
  store.initializeWorkspaceUi({ teams: [], rooms: [room], projectPath: room.projectPath, roomId: room.id });
});

test("hydration completion unlocks persistence without racing reconnect with a no-change save", async () => {
  const view = renderHook(() => useLocalHistoryPersistence(options()));
  useAppStore.getState().setHistoryHydrationStatusForRoom(room.id, "ready");
  await waitFor(() =>
    assert.equal(useAppStore.getState().historyPresenceByRoom[room.id]?.historyHydrationStatus, "ready")
  );
  await flushEncryptedHistorySaves(room.id);
  assert.equal(saves.length, 0);

  useAppStore.getState().appendRoomMessage(room.id, {
    id: "message-a",
    author: "Maddie",
    role: "human",
    body: "Changed after hydration",
    time: new Date().toISOString()
  });
  view.rerender();
  await waitFor(async () => {
    await flushEncryptedHistorySaves(room.id);
    assert.equal(saves.length, 1);
  });
  view.unmount();
});
