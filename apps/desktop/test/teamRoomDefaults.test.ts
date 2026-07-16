import assert from "node:assert/strict";
import test from "node:test";
import { defaultCodexModel } from "@multaiplayer/protocol";
import {
  isRoomSettingsMutationInFlight,
  loadTeamRoomDefaults,
  roomSettingsMutationInFlightMessage,
  saveTeamRoomDefaults,
  sanitizeTeamRoomDefaults,
  teamDefaultsRoomSettings,
  teamRoomDefaultsKey
} from "../src/lib/team/teamRoomDefaults";

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
    approvalPolicy: "ask_every_turn",
    codexModel: "gpt-5.4-thinking",
    browserAllowedOrigins: ["https://github.com", "https://example.com"],
    browserProfilePersistent: false,
    inviteApprovalGate: true
  });

  assert.deepEqual(saved, {
    approvalPolicy: "ask_every_turn",
    codexModel: "gpt-5.4-thinking",
    browserAllowedOrigins: ["https://github.com", "https://example.com"],
    browserProfilePersistent: false,
    inviteApprovalGate: true
  });
  assert.deepEqual(loadTeamRoomDefaults("team-core"), {
    approvalPolicy: "ask_every_turn",
    codexModel: "gpt-5.4-thinking",
    browserAllowedOrigins: ["https://github.com", "https://example.com"],
    browserProfilePersistent: false,
    inviteApprovalGate: true
  });
  assert.deepEqual(loadTeamRoomDefaults("team-labs"), {
    approvalPolicy: "ask_every_turn",
    codexModel: defaultCodexModel,
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: true,
    inviteApprovalGate: true
  });
});

test("team room defaults sanitize unsupported approval policies", () => {
  assert.deepEqual(sanitizeTeamRoomDefaults({ approvalPolicy: "surprise" as never }), {
    approvalPolicy: "ask_every_turn",
    codexModel: defaultCodexModel,
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: true,
    inviteApprovalGate: true
  });

  localStorage.setItem(teamRoomDefaultsKey("team-core"), JSON.stringify({ approvalPolicy: "nope" }));
  assert.deepEqual(loadTeamRoomDefaults("team-core"), {
    approvalPolicy: "ask_every_turn",
    codexModel: defaultCodexModel,
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: true,
    inviteApprovalGate: true
  });
});

test("team room defaults sanitize Codex model", () => {
  assert.deepEqual(
    sanitizeTeamRoomDefaults({
      approvalPolicy: "ask_every_turn",
      codexModel: "gpt-5.4-mini",
      browserAllowedOrigins: ["https://github.com"],
      browserProfilePersistent: true,
      inviteApprovalGate: false
    }),
    {
      approvalPolicy: "ask_every_turn",
      codexModel: "gpt-5.4-mini",
      browserAllowedOrigins: ["https://github.com"],
      browserProfilePersistent: true,
      inviteApprovalGate: true
    }
  );

  assert.deepEqual(sanitizeTeamRoomDefaults({ codexModel: "not a model id" }), {
    approvalPolicy: "ask_every_turn",
    codexModel: defaultCodexModel,
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: true,
    inviteApprovalGate: true
  });
});

test("team room defaults sanitize unsupported approval policy and browser settings", () => {
  assert.deepEqual(
    sanitizeTeamRoomDefaults({
      approvalPolicy: "unsupported" as never,
      codexModel: "gpt-5.4-thinking",
      browserAllowedOrigins: ["https://github.com/path"],
      browserProfilePersistent: "yes" as never
    }),
    {
      approvalPolicy: "ask_every_turn",
      codexModel: "gpt-5.4-thinking",
      browserAllowedOrigins: ["https://github.com"],
      browserProfilePersistent: true,
      inviteApprovalGate: true
    }
  );

  assert.deepEqual(
    sanitizeTeamRoomDefaults({
      approvalPolicy: "unsupported" as never,
      codexModel: "gpt-5.4-mini",
      browserAllowedOrigins: ["https://github.com", "https://github.com"],
      browserProfilePersistent: false,
      inviteApprovalGate: true
    }),
    {
      approvalPolicy: "ask_every_turn",
      codexModel: "gpt-5.4-mini",
      browserAllowedOrigins: ["https://github.com"],
      browserProfilePersistent: false,
      inviteApprovalGate: true
    }
  );
});

test("team room defaults sanitize invite policy", () => {
  assert.deepEqual(
    sanitizeTeamRoomDefaults({
      approvalPolicy: "ask_every_turn",
      codexModel: "gpt-5.4",
      browserAllowedOrigins: ["https://github.com"],
      browserProfilePersistent: true,
      inviteApprovalGate: "yes" as never
    }),
    {
      approvalPolicy: "ask_every_turn",
      codexModel: "gpt-5.4",
      browserAllowedOrigins: ["https://github.com"],
      browserProfilePersistent: true,
      inviteApprovalGate: true
    }
  );
});

test("team defaults room settings include only host-controlled room settings", () => {
  const defaults = {
    approvalPolicy: "ask_every_turn" as const,
    codexModel: "gpt-5.4-thinking",
    browserAllowedOrigins: ["https://github.com", "https://example.com"],
    browserProfilePersistent: false,
    inviteApprovalGate: true
  };
  const settings = teamDefaultsRoomSettings(defaults);

  assert.deepEqual(settings, {
    approvalPolicy: "ask_every_turn",
    codexModel: "gpt-5.4-thinking",
    browserAllowedOrigins: ["https://github.com", "https://example.com"],
    browserProfilePersistent: false
  });
  settings.browserAllowedOrigins.push("https://mutated.example");
  assert.deepEqual(defaults.browserAllowedOrigins, ["https://github.com", "https://example.com"]);
});

test("room settings mutation in-flight guard is scoped to one room", () => {
  assert.equal(isRoomSettingsMutationInFlight({ "room-a": true }, "room-a"), true);
  assert.equal(isRoomSettingsMutationInFlight({ "room-a": true }, "room-b"), false);
  assert.equal(isRoomSettingsMutationInFlight({ "room-a": false }, "room-a"), false);
  assert.equal(roomSettingsMutationInFlightMessage(), "Room settings are already being updated.");
});

test("team room defaults drop corrupted storage", () => {
  localStorage.setItem(teamRoomDefaultsKey("team-core"), "{");

  assert.deepEqual(loadTeamRoomDefaults("team-core"), {
    approvalPolicy: "ask_every_turn",
    codexModel: defaultCodexModel,
    browserAllowedOrigins: ["https://github.com"],
    browserProfilePersistent: true,
    inviteApprovalGate: true
  });
  assert.equal(localStorage.getItem(teamRoomDefaultsKey("team-core")), null);
});
