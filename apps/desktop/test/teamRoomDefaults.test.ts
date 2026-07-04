import assert from "node:assert/strict";
import test from "node:test";
import {
  loadTeamRoomDefaults,
  saveTeamRoomDefaults,
  sanitizeTeamRoomDefaults,
  teamRoomDefaultsKey
} from "../src/lib/teamRoomDefaults";

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
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage
});

test.beforeEach(() => {
  localStorage.clear();
});

test("team room defaults persist approval policy per team", () => {
  const saved = saveTeamRoomDefaults("team-core", {
    approvalPolicy: "auto_chat_only",
    browserAllowedOrigins: ["https://github.com", "https://example.com"],
    browserProfilePersistent: false
  });

  assert.deepEqual(saved, {
    approvalPolicy: "auto_chat_only",
    browserAllowedOrigins: ["https://github.com", "https://example.com"],
    browserProfilePersistent: false
  });
  assert.deepEqual(loadTeamRoomDefaults("team-core"), {
    approvalPolicy: "auto_chat_only",
    browserAllowedOrigins: ["https://github.com", "https://example.com"],
    browserProfilePersistent: false
  });
  assert.deepEqual(loadTeamRoomDefaults("team-labs"), {
    approvalPolicy: "ask_every_turn",
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: true
  });
});

test("team room defaults sanitize unsupported approval policies", () => {
  assert.deepEqual(sanitizeTeamRoomDefaults({ approvalPolicy: "surprise" as never }), {
    approvalPolicy: "ask_every_turn",
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: true
  });

  localStorage.setItem(teamRoomDefaultsKey("team-core"), JSON.stringify({ approvalPolicy: "nope" }));
  assert.deepEqual(loadTeamRoomDefaults("team-core"), {
    approvalPolicy: "ask_every_turn",
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: true
  });
});

test("team room defaults sanitize browser policy", () => {
  assert.deepEqual(sanitizeTeamRoomDefaults({
    approvalPolicy: "auto_browser_allowed_sites",
    browserAllowedOrigins: ["https://github.com/path"],
    browserProfilePersistent: "yes" as never
  }), {
    approvalPolicy: "auto_browser_allowed_sites",
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: true
  });

  assert.deepEqual(sanitizeTeamRoomDefaults({
    approvalPolicy: "auto_browser_allowed_sites",
    browserAllowedOrigins: ["https://github.com", "https://github.com"],
    browserProfilePersistent: false
  }), {
    approvalPolicy: "auto_browser_allowed_sites",
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: false
  });
});

test("team room defaults drop corrupted storage", () => {
  localStorage.setItem(teamRoomDefaultsKey("team-core"), "{");

  assert.deepEqual(loadTeamRoomDefaults("team-core"), {
    approvalPolicy: "ask_every_turn",
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: true
  });
  assert.equal(localStorage.getItem(teamRoomDefaultsKey("team-core")), null);
});
