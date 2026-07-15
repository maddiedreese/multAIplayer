import assert from "node:assert/strict";
import test from "node:test";
import { CodexActivityPlaintextPayload, CodexQueuePlaintextPayload, MlsRelayMessage } from "../src/index.js";
test("relay framing carries opaque MLS bytes without plaintext event fields", () => {
  const parsed = MlsRelayMessage.parse({
    id: "m1",
    teamId: "team",
    roomId: "room",
    senderUserId: "user",
    senderDeviceId: "device-1",
    createdAt: new Date().toISOString(),
    messageType: "application",
    epochHint: 0,
    mlsMessage: "AA=="
  });
  assert.equal(parsed.mlsMessage, "AA==");
  assert.equal("payload" in parsed, false);
});

test("host-handoff routing metadata is complete and commit-bound", () => {
  const base = {
    id: "m1",
    teamId: "team",
    roomId: "room",
    senderUserId: "user",
    senderDeviceId: "device-1",
    createdAt: new Date().toISOString(),
    epochHint: 0,
    mlsMessage: "AA=="
  };
  assert.equal(
    MlsRelayMessage.safeParse({
      ...base,
      messageType: "commit",
      commitEffect: "host_handoff",
      nextHostUserId: "next-user",
      nextHostDeviceId: "next-device",
      hostTransferAuthorization: {
        version: 2,
        transferId: "offer-1",
        roomId: "room",
        commitMessageId: "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
        parentEpoch: 0,
        outgoingHostUserId: "user",
        outgoingHostDeviceId: "device-1",
        nextHostUserId: "next-user",
        nextHostDeviceId: "next-device",
        nextHostLeaf: 1,
        signatureDer: "AA==",
        publicKeySpkiDer: "AA=="
      }
    }).success,
    true
  );
  assert.equal(
    MlsRelayMessage.safeParse({ ...base, messageType: "application", commitEffect: "host_handoff" }).success,
    false
  );
});

test("queued Codex events require a queue position", () => {
  const base = {
    eventType: "codex.queue",
    queueEventId: "queue-1",
    turnId: "turn-1",
    requestedBy: "User",
    requestedByUserId: "user",
    queueSize: 1,
    createdAt: new Date().toISOString()
  };
  assert.equal(CodexQueuePlaintextPayload.safeParse({ ...base, action: "queued", queuePosition: 1 }).success, true);
  assert.equal(CodexQueuePlaintextPayload.safeParse({ ...base, action: "promoted" }).success, false);
  assert.equal(CodexQueuePlaintextPayload.safeParse({ ...base, action: "cancelled" }).success, true);
});

test("Codex activities accept bounded disclosure details", () => {
  const base = {
    eventType: "codex.activity",
    activityId: "activity-1",
    turnId: "turn-1",
    itemId: "item-1",
    kind: "reasoning",
    status: "completed",
    title: "Reasoning",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    host: "Host",
    hostUserId: "host-user"
  };
  assert.equal(
    CodexActivityPlaintextPayload.safeParse({
      ...base,
      details: {
        type: "reasoning",
        summaries: ["Checked the protocol boundary."],
        rawContent: ["Provider-supplied raw reasoning."]
      }
    }).success,
    true
  );
  assert.equal(
    CodexActivityPlaintextPayload.safeParse({
      ...base,
      details: { type: "reasoning", summaries: ["x".repeat(4_097)] }
    }).success,
    false
  );
  assert.equal(
    CodexActivityPlaintextPayload.safeParse({
      ...base,
      details: { type: "reasoning", summaries: [], rawContent: ["x".repeat(4_097)] }
    }).success,
    false
  );
});

test("Codex activity detail is kind-specific and bounded", () => {
  const parsed = CodexActivityPlaintextPayload.safeParse({
    eventType: "codex.activity",
    activityId: "activity-1",
    turnId: "turn-1",
    itemId: "item-1",
    kind: "file_change",
    status: "completed",
    title: "File change",
    details: {
      type: "file_change",
      changes: [{ path: "src/app.ts", action: "update", diff: "+const ready = true;" }]
    },
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    host: "Host",
    hostUserId: "host-user"
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.details?.type, "file_change");
});
