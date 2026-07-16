import assert from "node:assert/strict";
import test from "node:test";
import { RelayStoreByteCapacityError, RelayStoreCapacityError } from "../../src/state.js";
import { relayWebSocketError } from "../../src/ws/connection.js";
import { dispatchRelayClientMessage } from "../../src/ws/connection-dispatch.js";
import type { RelayWebSocketConnectionOptions } from "../../src/ws/connection-types.js";

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

test("presence publication stops when the joined room becomes inactive", async () => {
  const sent: unknown[] = [];
  const roster = new Map([["existing-device", { displayName: "Existing" }]]);
  let published = false;
  const socket = {};
  const session = {
    socket,
    rateClientId: "test",
    teamId: "team-core",
    roomId: "room-desktop",
    userId: "github:member",
    deviceId: "device-member",
    subscribedTeamIds: new Set<string>(),
    workspaceSubscribed: false
  };
  const options = {
    transport: { send: (_socket: unknown, message: unknown) => sent.push(message) },
    rooms: {
      isKnownRoom: () => false,
      publishPresence: () => {
        published = true;
        roster.set("device-member", { displayName: "Member" });
      }
    }
  } as unknown as RelayWebSocketConnectionOptions;

  await dispatchRelayClientMessage(options, session as never, {
    type: "presence",
    teamId: "team-core",
    roomId: "room-desktop",
    userId: "github:member",
    deviceId: "device-member",
    displayName: "Member",
    status: "online"
  });

  assert.equal(published, false);
  assert.deepEqual(Array.from(roster.keys()), ["existing-device"]);
  assert.deepEqual(sent, [
    { type: "error", message: "Join the room before publishing presence with this user and device." }
  ]);
});
