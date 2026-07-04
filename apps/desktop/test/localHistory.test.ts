import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
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

  dump(): string {
    return Array.from(this.values.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
  }
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {}
});

const {
  acknowledgeRoomVisibilityWarning,
  clearEncryptedHistory,
  clearRoomVisibilityWarningAcknowledgement,
  forgetRoomLocalData,
  hasAcknowledgedRoomVisibilityWarning,
  importRoomSecret,
  loadEncryptedHistory,
  loadHistorySettings,
  loadRoomSecret,
  roomVisibilityWarningKey,
  saveEncryptedHistory,
  saveHistorySettings
} = {
  ...(await import("../src/lib/localHistory")),
  ...(await import("../src/lib/roomVisibilityWarning"))
};

test.beforeEach(() => {
  localStorage.clear();
});

test("encrypted history stores no plaintext transcript while remaining recoverable", async () => {
  const roomId = "room-local-history";
  const payload = {
    version: 2,
    messages: [
      {
        id: "msg-secret",
        author: "Maddie",
        role: "human",
        body: "super secret room transcript",
        time: "10:00 AM"
      }
    ]
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /super secret room transcript/);
  assert.doesNotMatch(localStorage.dump(), /super secret room transcript/);

  await assert.doesNotReject(async () => {
    const restored = await loadEncryptedHistory<typeof payload>(roomId);
    assert.deepEqual(restored, payload);
  });
});

test("encrypted history keeps Codex thread continuity local and encrypted", async () => {
  const roomId = "room-codex-thread-history";
  const payload = {
    version: 2,
    messages: [],
    terminalRequests: [],
    browserRequests: [],
    inviteRequests: [],
    codexEvents: [],
    hostHandoffs: [],
    codexThreadId: "thr_room_123"
  };

  await saveEncryptedHistory(roomId, payload);

  const stored = localStorage.getItem(`multaiplayer:history:${roomId}`);
  assert.ok(stored);
  assert.doesNotMatch(stored, /thr_room_123/);
  assert.deepEqual(await loadEncryptedHistory<typeof payload>(roomId), payload);
});

test("disabled history clears stored ciphertext and prevents new saves", async () => {
  const roomId = "room-history-off";

  await saveEncryptedHistory(roomId, { messages: [{ body: "keep me encrypted" }] });
  assert.ok(localStorage.getItem(`multaiplayer:history:${roomId}`));

  const savedSettings = saveHistorySettings(roomId, { enabled: false, retentionDays: 30 });
  assert.deepEqual(savedSettings, { enabled: false, retentionDays: 30 });
  assert.equal(localStorage.getItem(`multaiplayer:history:${roomId}`), null);

  await saveEncryptedHistory(roomId, { messages: [{ body: "do not persist" }] });
  assert.equal(localStorage.getItem(`multaiplayer:history:${roomId}`), null);
  assert.equal(await loadEncryptedHistory(roomId), null);
});

test("expired encrypted history is removed on load", async () => {
  const roomId = "room-expired-history";
  saveHistorySettings(roomId, { enabled: true, retentionDays: 1 });
  await saveEncryptedHistory(roomId, { messages: [{ body: "old encrypted value" }] });

  const key = `multaiplayer:history:${roomId}`;
  const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as { savedAt: string };
  localStorage.setItem(
    key,
    JSON.stringify({
      ...stored,
      savedAt: "2001-01-01T00:00:00.000Z"
    })
  );

  assert.equal(await loadEncryptedHistory(roomId), null);
  assert.equal(localStorage.getItem(key), null);
});

test("history retention settings are sanitized to the supported range", () => {
  assert.deepEqual(saveHistorySettings("room-low", { enabled: true, retentionDays: -10 }), {
    enabled: true,
    retentionDays: 1
  });
  assert.deepEqual(saveHistorySettings("room-high", { enabled: true, retentionDays: 1000 }), {
    enabled: true,
    retentionDays: 365
  });
  assert.deepEqual(loadHistorySettings("missing-room"), {
    enabled: true,
    retentionDays: 30
  });
});

test("clearEncryptedHistory removes only the selected room payload", async () => {
  await saveEncryptedHistory("room-a", { messages: [{ body: "alpha" }] });
  await saveEncryptedHistory("room-b", { messages: [{ body: "beta" }] });

  await clearEncryptedHistory("room-a");

  assert.equal(localStorage.getItem("multaiplayer:history:room-a"), null);
  assert.ok(localStorage.getItem("multaiplayer:history:room-b"));
  assert.deepEqual(await loadEncryptedHistory("room-b"), { messages: [{ body: "beta" }] });
});

test("loadEncryptedHistory does not create a room secret when no history exists", async () => {
  assert.equal(await loadEncryptedHistory("room-no-history"), null);
  assert.equal(localStorage.getItem("multaiplayer:room-secret:room-no-history"), null);
});

test("forgetRoomLocalData removes history, settings, and the local fallback room secret", async () => {
  await saveEncryptedHistory("room-a", { messages: [{ body: "alpha" }] });
  await importRoomSecret("room-a", {
    algorithm: "AES-GCM-256",
    rawKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  });
  saveHistorySettings("room-a", { enabled: true, retentionDays: 12 });

  await saveEncryptedHistory("room-b", { messages: [{ body: "beta" }] });

  await forgetRoomLocalData("room-a");

  assert.equal(localStorage.getItem("multaiplayer:history:room-a"), null);
  assert.equal(localStorage.getItem("multaiplayer:history-settings:room-a"), null);
  assert.equal(localStorage.getItem("multaiplayer:room-secret:room-a"), null);
  assert.equal(await loadRoomSecret("room-a"), null);
  assert.ok(localStorage.getItem("multaiplayer:history:room-b"));
});

test("room visibility warning acknowledgement is scoped and resettable per room", () => {
  assert.equal(hasAcknowledgedRoomVisibilityWarning("room-a"), false);
  assert.equal(hasAcknowledgedRoomVisibilityWarning("room-b"), false);

  acknowledgeRoomVisibilityWarning("room-a");

  assert.equal(hasAcknowledgedRoomVisibilityWarning("room-a"), true);
  assert.equal(hasAcknowledgedRoomVisibilityWarning("room-b"), false);
  assert.equal(localStorage.getItem(roomVisibilityWarningKey("room-a")), "acknowledged");

  clearRoomVisibilityWarningAcknowledgement("room-a");

  assert.equal(hasAcknowledgedRoomVisibilityWarning("room-a"), false);
  assert.equal(hasAcknowledgedRoomVisibilityWarning(""), true);
});
