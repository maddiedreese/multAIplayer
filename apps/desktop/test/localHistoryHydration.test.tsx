import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderHook, waitFor } from "@testing-library/react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });

let loadHistory: () => Promise<string | null> = async () => null;
let nativeInvocations: string[] = [];
Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
  configurable: true,
  value: {
    invoke: async (command: string) => {
      nativeInvocations.push(command);
      if (command === "mls_history_load_latest") return loadHistory();
      if (command === "mls_history_retention_set") return 1;
      throw new Error(`Unexpected command ${command}`);
    }
  }
});
Object.defineProperty(dom.window, "__TAURI_INTERNALS__", {
  configurable: true,
  value: (globalThis as typeof globalThis & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__
});

const { useAppStore } = await import("../src/store/appStore");
const { useLocalHistoryHydration } = await import("../src/hooks/useLocalHistoryHydration");
const noForgottenRoomIds = new Set<string>();

function currentHistory(messages: unknown[]) {
  return {
    version: 3,
    messages,
    terminalRequests: [],
    fileSaveRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    gitWorkflowEvents: [],
    githubActionsEvents: [],
    localPreviews: [],
    terminalSnapshots: [],
    hostHandoffs: []
  };
}

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function mountHydration() {
  return renderHook(() =>
    useLocalHistoryHydration({
      hasSelectedRoom: true,
      selectedRoomId: "room-a",
      selectedRoomTeamId: "team-a",
      forgottenRoomIds: noForgottenRoomIds,
      replaceHistorySettings: () => undefined,
      hydrateLocalRoomHistoryForRoom: (roomId, payload) =>
        useAppStore.getState().hydrateLocalRoomHistoryForRoom(roomId, payload),
      hydrateRoomReadState: (roomId, readState) => useAppStore.getState().hydrateRoomReadState(roomId, readState)
    })
  );
}

test.beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("multaiplayer:history-settings:room-a", JSON.stringify({ enabled: true, retentionDays: 30 }));
  useAppStore.getState().resetAppStore();
  loadHistory = async () => null;
  nativeInvocations = [];
});

test("no selected room does not start native history hydration", async () => {
  const view = renderHook(() =>
    useLocalHistoryHydration({
      hasSelectedRoom: false,
      selectedRoomId: "",
      selectedRoomTeamId: "",
      forgottenRoomIds: noForgottenRoomIds,
      replaceHistorySettings: () => undefined,
      hydrateLocalRoomHistoryForRoom: (roomId, payload) =>
        useAppStore.getState().hydrateLocalRoomHistoryForRoom(roomId, payload),
      hydrateRoomReadState: (roomId, readState) => useAppStore.getState().hydrateRoomReadState(roomId, readState)
    })
  );

  await Promise.resolve();
  assert.deepEqual(nativeInvocations, []);
  assert.equal(useAppStore.getState().historyPresenceByRoom[""], undefined);
  view.unmount();
});

test("delayed hydration merges a live message instead of overwriting it", async () => {
  let release!: (value: string) => void;
  loadHistory = () => new Promise((resolve) => (release = resolve));
  const view = mountHydration();
  await waitFor(() =>
    assert.equal(useAppStore.getState().historyPresenceByRoom["room-a"]?.historyHydrationStatus, "loading")
  );
  await waitFor(() => assert.equal(typeof release, "function"));
  useAppStore.getState().appendRoomMessage("room-a", {
    id: "same-id",
    author: "Maddie",
    role: "human",
    body: "Arrived live",
    time: "now"
  });
  release(
    encoded(
      currentHistory([
        { id: "stored", author: "Alex", role: "human", body: "Stored", time: "earlier" },
        { id: "same-id", author: "Alex", role: "human", body: "Stale duplicate", time: "earlier" }
      ])
    )
  );
  await waitFor(() =>
    assert.equal(useAppStore.getState().historyPresenceByRoom["room-a"]?.historyHydrationStatus, "ready")
  );
  assert.deepEqual(
    useAppStore.getState().messagesByRoom["room-a"]?.map((message) => message.id),
    ["stored", "same-id"]
  );
  assert.equal(useAppStore.getState().messagesByRoom["room-a"]?.at(-1)?.body, "Arrived live");
  view.unmount();
});

test("failed current-schema hydration remains paused and a successful retry preserves live state", async () => {
  loadHistory = async () => encoded({ ...currentHistory([]), messages: "corrupt" });
  const view = mountHydration();
  await waitFor(() =>
    assert.equal(useAppStore.getState().historyPresenceByRoom["room-a"]?.historyHydrationStatus, "failed")
  );
  useAppStore.getState().appendRoomMessage("room-a", {
    id: "live-after-failure",
    author: "Maddie",
    role: "human",
    body: "Still here",
    time: "now"
  });
  loadHistory = async () =>
    encoded(currentHistory([{ id: "stored", author: "Alex", role: "human", body: "Stored", time: "earlier" }]));
  useAppStore.getState().retryHistoryHydrationForRoom("room-a");
  await waitFor(() =>
    assert.equal(useAppStore.getState().historyPresenceByRoom["room-a"]?.historyHydrationStatus, "ready")
  );
  assert.deepEqual(
    useAppStore.getState().messagesByRoom["room-a"]?.map((message) => message.id),
    ["stored", "live-after-failure"]
  );
  view.unmount();
});

test("automatic hydration recovery clears only its matching stale failure message", async () => {
  loadHistory = async () => encoded({ ...currentHistory([]), messages: "corrupt" });
  const failed = mountHydration();
  await waitFor(() =>
    assert.equal(useAppStore.getState().historyPresenceByRoom["room-a"]?.historyHydrationStatus, "failed")
  );
  failed.unmount();
  loadHistory = async () => encoded(currentHistory([]));
  const recovered = mountHydration();
  await waitFor(() =>
    assert.equal(useAppStore.getState().historyPresenceByRoom["room-a"]?.historyHydrationStatus, "ready")
  );
  assert.equal(useAppStore.getState().historyPresenceByRoom["room-a"]?.historyMessage, undefined);
  recovered.unmount();
});
