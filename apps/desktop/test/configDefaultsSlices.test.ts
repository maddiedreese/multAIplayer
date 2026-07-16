import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { matchMedia: () => ({ matches: false }) }
});

const { useAppStore } = await import("../src/store/appStore");
const { saveTeamHistorySettings } = await import("../src/lib/history/localHistory");
const { saveTeamRoomDefaults } = await import("../src/lib/team/teamRoomDefaults");

test.beforeEach(() => {
  localStorage.clear();
  useAppStore.getState().resetAppStore();
});

test("relay configuration actions normalize, persist, and reset drafts atomically", () => {
  const store = useAppStore.getState();
  store.setRelayHttpDraft("https://relay.example.com/");
  store.setRelayWsDraft("wss://relay.example.com/rooms/");
  store.saveRelayConfiguration();

  let state = useAppStore.getState();
  assert.deepEqual(state.appConfig, {
    relayHttpUrl: "https://relay.example.com",
    relayWsUrl: "wss://relay.example.com/rooms"
  });
  assert.equal(state.relayHttpDraft, state.appConfig.relayHttpUrl);
  assert.equal(state.relayWsDraft, state.appConfig.relayWsUrl);
  assert.match(state.appConfigMessage ?? "", /saved/i);

  state.setRelayHttpDraft("not a URL");
  state.saveRelayConfiguration();
  state = useAppStore.getState();
  assert.deepEqual(state.appConfig, {
    relayHttpUrl: "https://relay.example.com",
    relayWsUrl: "wss://relay.example.com/rooms"
  });
  assert.match(state.appConfigMessage ?? "", /invalid url/i);

  state.resetRelayConfiguration();
  state = useAppStore.getState();
  assert.equal(state.relayHttpDraft, state.appConfig.relayHttpUrl);
  assert.equal(state.relayWsDraft, state.appConfig.relayWsUrl);
  assert.equal(localStorage.getItem("multaiplayer:app-config"), null);
});

test("resetAppStore reloads the persisted relay configuration", () => {
  localStorage.setItem(
    "multaiplayer:app-config",
    JSON.stringify({
      relayHttpUrl: "https://persisted.example.com",
      relayWsUrl: "wss://persisted.example.com/rooms"
    })
  );

  useAppStore.getState().resetAppStore();

  assert.deepEqual(useAppStore.getState().appConfig, {
    relayHttpUrl: "https://persisted.example.com",
    relayWsUrl: "wss://persisted.example.com/rooms"
  });
});

test("team defaults load into one coherent store snapshot", () => {
  saveTeamHistorySettings("team-config", { enabled: false, retentionDays: 14 });
  saveTeamRoomDefaults("team-config", {
    approvalPolicy: "never_host",
    codexModel: "gpt-5.4-thinking",
    inviteApprovalGate: false
  });

  useAppStore.getState().loadDefaultsForTeam("team-config");

  const state = useAppStore.getState();
  assert.deepEqual(state.teamHistorySettings, { enabled: false, retentionDays: 14 });
  assert.equal(state.teamDefaultApprovalPolicy, "never_host");
  assert.equal(state.teamDefaultCodexModel, "gpt-5.4-thinking");
  assert.equal(state.teamDefaultInviteApprovalGate, true);
});

test("history defaults setters are reset without mutating persisted team defaults", () => {
  const store = useAppStore.getState();
  store.setHistorySettings({ enabled: false, retentionDays: 7 });
  store.setTeamHistorySettings({ enabled: false, retentionDays: 21 });
  store.setTeamDefaultInviteApprovalGate(false);

  store.resetAppStore();

  const state = useAppStore.getState();
  assert.deepEqual(state.historySettings, { enabled: true, retentionDays: 30 });
  assert.deepEqual(state.teamHistorySettings, { enabled: true, retentionDays: 30 });
  assert.equal(state.teamDefaultInviteApprovalGate, true);
});
