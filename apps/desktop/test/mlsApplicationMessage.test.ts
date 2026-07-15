import assert from "node:assert/strict";
import test from "node:test";
import { parseMlsAuthenticatedData } from "../src/lib/mls/mlsClient";

test("MLS authenticated data binds exact routing identity and message metadata", () => {
  const value = {
    version: 1 as const,
    epoch: 7,
    messageId: "message-1",
    teamId: "team-1",
    roomId: "room-1",
    kind: "chat.message",
    senderUserId: "github:user-1",
    senderDeviceId: "device-1",
    createdAt: "2026-07-12T12:00:00.000Z"
  };
  assert.deepEqual(parseMlsAuthenticatedData(JSON.stringify(value)), value);
});

test("MLS authenticated data rejects missing and unknown routing fields", () => {
  assert.equal(
    parseMlsAuthenticatedData(
      JSON.stringify({
        version: 1,
        epoch: 7,
        messageId: "message-1",
        teamId: "team-1",
        roomId: "room-1",
        kind: "chat.message",
        senderUserId: "github:user-1",
        createdAt: "2026-07-12T12:00:00.000Z"
      })
    ),
    null
  );
  assert.equal(
    parseMlsAuthenticatedData(
      JSON.stringify({
        version: 1,
        epoch: 7,
        messageId: "message-1",
        teamId: "team-1",
        roomId: "room-1",
        kind: "chat.message",
        senderUserId: "github:user-1",
        senderDeviceId: "device-1",
        createdAt: "2026-07-12T12:00:00.000Z",
        downgrade: true
      })
    ),
    null
  );
});
