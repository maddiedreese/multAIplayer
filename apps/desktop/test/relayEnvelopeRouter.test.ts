import assert from "node:assert/strict";
import test from "node:test";
import type { CodexQueuePlaintextPayload } from "@multaiplayer/protocol";
import { handleCodexQueueEvent } from "../src/hooks/relay/routeRelayEnvelope";
import { useAppStore } from "../src/store/appStore";

test.beforeEach(() => useAppStore.getState().resetAppStore());

function queueEvent(
  action: CodexQueuePlaintextPayload["action"],
  overrides: Partial<CodexQueuePlaintextPayload> = {}
): CodexQueuePlaintextPayload {
  return {
    eventType: "codex.queue",
    queueEventId: `queue-${action}`,
    turnId: "turn-1",
    action,
    requestedBy: "Avery",
    requestedByUserId: "github:avery",
    queueSize: action === "queued" ? 1 : 0,
    createdAt: "2026-07-09T12:00:00.000Z",
    ...overrides
  };
}

test("Codex queue routing dispatches through one store action surface", () => {
  handleCodexQueueEvent(queueEvent("queued", { triggerMessageId: "message-1" }), "room-a", useAppStore.getState());

  let state = useAppStore.getState();
  assert.deepEqual(state.codexRuntimeByRoom["room-a"]?.queuedApprovals, [{
    roomId: "room-a",
    turnId: "turn-1",
    requestedBy: "Avery",
    requestedByUserId: "github:avery",
    queuedAt: "2026-07-09T12:00:00.000Z",
    triggerMessageId: "message-1"
  }]);
  assert.equal(state.roomSettingsByRoom["room-a"]?.hostMessage, "Avery proposed a Codex turn for host approval.");

  state.setApprovalVisibleForRoom("room-a", true);
  handleCodexQueueEvent(queueEvent("cancelled", { reason: "Requester cancelled." }), "room-a", useAppStore.getState());
  state = useAppStore.getState();
  assert.equal(state.codexRuntimeByRoom["room-a"]?.queuedApprovals, undefined);
  assert.equal(state.codexRuntimeByRoom["room-a"]?.approvalVisible, undefined);
  assert.equal(state.roomSettingsByRoom["room-a"]?.hostMessage, "Requester cancelled.");
});
