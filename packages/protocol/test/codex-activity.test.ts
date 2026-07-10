import assert from "node:assert/strict";
import test from "node:test";
import { CodexActivityPlaintextPayload, RelayEnvelope } from "../src/index.js";

test("canonical Codex activity is bounded and strips undeclared upstream data", () => {
  const parsed = CodexActivityPlaintextPayload.parse({
    eventType: "codex.activity",
    activityId: "turn-1-item-1",
    turnId: "turn-1",
    itemId: "item-1",
    kind: "command",
    status: "running",
    title: "Command execution",
    startedAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:01.000Z",
    host: "Host",
    hostUserId: "user-host",
    command: "echo secret",
    raw: { environment: { TOKEN: "secret" } }
  });
  assert.equal("command" in parsed, false);
  assert.equal("raw" in parsed, false);
  assert.throws(() => CodexActivityPlaintextPayload.parse({ ...parsed, title: "x".repeat(1_000) }));
});

test("encrypted relay envelopes accept the canonical activity kind", () => {
  const result = RelayEnvelope.safeParse({
    id: "envelope-1",
    teamId: "team-1",
    roomId: "room-1",
    senderDeviceId: "device-1",
    senderUserId: "user-1",
    createdAt: "2026-07-09T12:00:01.000Z",
    kind: "codex.activity",
    payload: { algorithm: "AES-GCM-256", nonce: "a".repeat(16), ciphertext: "a".repeat(16) }
  });
  assert.equal(result.success, true);
});
