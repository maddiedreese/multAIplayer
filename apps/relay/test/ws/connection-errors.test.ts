import assert from "node:assert/strict";
import test from "node:test";
import { RelayStoreByteCapacityError, RelayStoreCapacityError } from "../../src/state.js";
import { relayWebSocketError } from "../../src/ws/connection.js";

test("WebSocket capacity failures use a stable code without exposing internal ceiling prose", () => {
  for (const error of [
    new RelayStoreCapacityError(10, "team"),
    new RelayStoreByteCapacityError("mls_backlog", 10, "room", "team:room")
  ]) {
    const response = relayWebSocketError(error, "message-one");
    assert.equal(response.code, "capacity_exceeded");
    assert.equal(response.message, "Relay durable capacity is exhausted.");
    assert.equal(response.messageId, "message-one");
    assert.equal(JSON.stringify(response).includes("10"), false);
  }
});
