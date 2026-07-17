import assert from "node:assert/strict";
import test from "node:test";
import { useRelayPublishers } from "../src/hooks/useRelayPublishers";

test("room publishers do not mutate local state or touch the relay without a selected room", async () => {
  const localMutations: string[] = [];
  const relayCalls: unknown[] = [];
  const publishers = useRelayPublishers({
    relayRef: {
      current: {
        publish: (message: unknown) => relayCalls.push(message)
      }
    } as never,
    seenEnvelopeIds: { current: new Set<string>() },
    relayStatus: "open",
    selectedRoom: null,
    deviceId: "device-local",
    localUser: { id: "github:local", name: "Local User" },
    approvalPolicyLabels: {},
    appendLocalPreviewEvent: (roomId) => localMutations.push(`preview:${roomId}`),
    appendGitWorkflowEvent: (roomId) => localMutations.push(`git:${roomId}`),
    appendCodexEvent: (roomId) => localMutations.push(`codex:${roomId}`),
    upsertCodexActivity: (roomId) => localMutations.push(`activity:${roomId}`),
    appendTerminalLinesForRoom: (roomId) => localMutations.push(`terminal:${roomId}`),
    appendRoomMessage: (roomId) => localMutations.push(`message:${roomId}`),
    appendGitHubActionsEvent: (roomId) => localMutations.push(`actions:${roomId}`)
  });

  await publishers.publishRequestStatus("browser.event", "request-1", "approved");
  await publishers.publishLocalPreviewEvent({
    id: "preview-1",
    eventType: "local.preview",
    sharedBy: "Local User",
    sharedByUserId: "github:local",
    sourceUrl: "http://127.0.0.1:3000",
    createdAt: new Date().toISOString(),
    status: "stopped",
    updatedAt: new Date().toISOString()
  });
  await publishers.publishCodexEvent({ turnId: "turn-1", status: "event", message: "No room", model: "gpt-5.4" });

  assert.deepEqual(localMutations, []);
  assert.deepEqual(relayCalls, []);
});
