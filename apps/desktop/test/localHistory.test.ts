import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { defaultTestRoom } from "./support/workspaceFixtures";

const calls: Array<{ command: string; args: unknown }> = [];
let latest: string | null = null;
let retentionFailure: unknown = null;
let saveGate: Promise<void> | null = null;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: (() => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear()
    };
  })()
});
Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
  configurable: true,
  value: {
    invoke: async (command: string, args: { request?: { plaintext?: string } }) => {
      calls.push({ command, args });
      if (command === "mls_history_load_latest") return latest;
      if (command === "mls_history_save") {
        if (saveGate) await saveGate;
        latest = args.request?.plaintext ?? null;
        return 7;
      }
      if (command === "mls_history_delete_all" || command === "mls_room_local_data_delete") {
        latest = null;
        return null;
      }
      if (command === "mls_history_retention_set") {
        if (retentionFailure) throw retentionFailure;
        return 7;
      }
      throw new Error(`Unexpected command ${command}`);
    }
  }
});

const history = await import("../src/lib/history/localHistory");
const { currentEligibleHistorySnapshots } = await import("../src/application/history/localHistorySnapshot");
const { useAppStore } = await import("../src/store/appStore");

beforeEach(() => {
  calls.length = 0;
  latest = null;
  retentionFailure = null;
  saveGate = null;
  localStorage.clear();
});

test("native MLS history survives a fresh JavaScript process index", async () => {
  latest = encode({ messages: ["retained"] });
  assert.deepEqual(await history.loadEncryptedHistory("room-a"), { messages: ["retained"] });
  assert.equal(calls[0]?.command, "mls_history_load_latest");
});

test("history save passes bounded retention policy to native encrypted storage", async () => {
  await history.saveHistorySettings("room-a", { enabled: true, retentionDays: 45 });
  await history.saveEncryptedHistory("room-a", { body: "private marker" });
  const save = calls.find((call) => call.command === "mls_history_save");
  assert.ok(save && typeof save.args === "object" && save.args !== null && "request" in save.args);
  const request = (save.args as { request: { retentionDays: number; plaintext: string } }).request;
  assert.equal(request.retentionDays, 45);
  assert.equal(Buffer.from(request.plaintext, "base64").toString("utf8"), '{"body":"private marker"}');
  assert.equal(localStorage.getItem("multaiplayer:room-secret:room-a"), null);
});

test("clearing history deletes every retained epoch in native storage", async () => {
  await history.clearEncryptedHistory("room-a");
  assert.deepEqual(calls.at(-1), {
    command: "mls_history_delete_all",
    args: { request: { roomId: "room-a" } }
  });
});

test("forgetting a room removes history and the durable MLS-only room config", async () => {
  await history.saveHistorySettings("room-a", { enabled: true, retentionDays: 30 });
  await history.forgetRoomLocalData("room-a");
  assert.deepEqual(calls.at(-1), {
    command: "mls_room_local_data_delete",
    args: { request: { roomId: "room-a" } }
  });
  assert.equal(history.hasHistorySettings("room-a"), false);
});

test("clearing history cannot be undone by an active or queued snapshot", async () => {
  let releaseSave!: () => void;
  saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  history.seedNewRoomHistorySettings("room-a", { enabled: true, retentionDays: 30 });
  const unexpectedError = (error: unknown) => assert.fail(String(error));

  history.queueEncryptedHistorySave("room-a", { revision: 1 }, unexpectedError);
  history.queueEncryptedHistorySave("room-a", { revision: 2 }, unexpectedError);
  const clearing = history.clearEncryptedHistory("room-a");
  history.queueEncryptedHistorySave("room-a", { revision: 3 }, unexpectedError);
  releaseSave();

  await clearing;
  await history.flushEncryptedHistorySaves("room-a");
  assert.equal(latest, null);
  assert.deepEqual(
    calls.map((call) => call.command),
    ["mls_history_save", "mls_history_delete_all"]
  );
});

test("forgetting room data cannot be undone by a queued snapshot", async () => {
  let releaseSave!: () => void;
  saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  history.seedNewRoomHistorySettings("room-a", { enabled: true, retentionDays: 30 });
  const unexpectedError = (error: unknown) => assert.fail(String(error));

  history.queueEncryptedHistorySave("room-a", { revision: 1 }, unexpectedError);
  history.queueEncryptedHistorySave("room-a", { revision: 2 }, unexpectedError);
  const forgetting = history.forgetRoomLocalData("room-a");
  releaseSave();

  await forgetting;
  await history.flushEncryptedHistorySaves("room-a");
  assert.equal(latest, null);
  assert.equal(history.hasHistorySettings("room-a"), false);
  assert.deepEqual(
    calls.map((call) => call.command),
    ["mls_history_save", "mls_room_local_data_delete"]
  );
});

test("history settings remain non-secret and sanitized", async () => {
  assert.deepEqual(await history.saveHistorySettings("room-a", { enabled: true, retentionDays: 900 }), {
    enabled: true,
    retentionDays: 365
  });
  assert.deepEqual(history.loadHistorySettings("room-a"), { enabled: true, retentionDays: 365 });
});

test("new-room history preferences persist without opening native MLS storage", () => {
  assert.deepEqual(history.seedNewRoomHistorySettings("room-new", { enabled: true, retentionDays: 900 }), {
    enabled: true,
    retentionDays: 365
  });
  assert.deepEqual(history.loadHistorySettings("room-new"), { enabled: true, retentionDays: 365 });
  assert.deepEqual(calls, []);
});

test("new-room history preferences apply after its MLS group exists", async () => {
  history.seedNewRoomHistorySettings("room-new", { enabled: true, retentionDays: 45 });
  await history.applyHistorySettingsToMlsGroup("room-new");
  assert.deepEqual(calls, [
    {
      command: "mls_history_retention_set",
      args: { request: { roomId: "room-new", retentionDays: 45 } }
    }
  ]);
});

test("history retention failure does not publish a false local setting", async () => {
  await history.saveHistorySettings("room-a", { enabled: true, retentionDays: 30 });
  retentionFailure = { code: "storage_error", message: "native store unavailable" };
  await assert.rejects(
    history.saveHistorySettings("room-a", { enabled: true, retentionDays: 90 }),
    /native store unavailable/
  );
  assert.deepEqual(history.loadHistorySettings("room-a"), { enabled: true, retentionDays: 30 });
});

test("close snapshot construction includes current state from every hydrated eligible room", () => {
  const room = (id: string) => ({
    ...defaultTestRoom,
    id,
    teamId: "team-a",
    name: id,
    projectPath: `/tmp/${id}`,
    host: "Maddie",
    hostUserId: "github:maddie",
    hostStatus: "active" as const,
    approvalPolicy: "ask_every_turn" as const,
    codexModel: "gpt-5.4",
    unread: 0
  });
  const store = useAppStore.getState();
  store.resetAppStore();
  useAppStore.setState({ rooms: [room("room-a"), room("room-b")], selectedRoomId: "room-a" });
  store.setHistoryHydrationStatusForRoom("room-a", "ready");
  store.setHistoryHydrationStatusForRoom("room-b", "ready");
  store.appendRoomMessage("room-a", { id: "a", author: "A", role: "human", body: "A", time: new Date().toISOString() });
  store.appendRoomMessage("room-b", { id: "b", author: "B", role: "human", body: "B", time: new Date().toISOString() });
  history.seedNewRoomHistorySettings("room-a", { enabled: true, retentionDays: 30 });
  history.seedNewRoomHistorySettings("room-b", { enabled: true, retentionDays: 30 });
  const snapshots = currentEligibleHistorySnapshots(useAppStore.getState());
  assert.deepEqual(
    snapshots.map(([roomId]) => roomId),
    ["room-a", "room-b"]
  );
  assert.deepEqual(
    snapshots.map(([, payload]) => payload.messages[0]?.id),
    ["a", "b"]
  );
});
