import assert from "node:assert/strict";
import test from "node:test";
import { CodexQueuePlaintextPayload, MlsRelayMessage } from "../src/index.js";
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
        version: 1,
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
