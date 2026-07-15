import assert from "node:assert/strict";
import test from "node:test";
import {
  canActOnRoomTerminalRequest,
  findRoomTerminalRequest,
  isRoomTerminalActionInFlight,
  roomTerminalActionInFlightMessage,
  roomTerminalRequestMessage,
  terminalRequestForApprovedRun
} from "../src/lib/terminal/terminalApproval";

const request = {
  id: "terminal-request-1",
  requester: "Peer",
  requesterUserId: "github:peer",
  command: " npm test ",
  cwd: "/tmp/not-the-room-project",
  requestedAt: "2026-07-04T12:00:00.000Z",
  status: "pending" as const
};

test("approved terminal requests run inside the room project path", () => {
  const approved = terminalRequestForApprovedRun(request, " /Users/maddie/project ");

  assert.equal(approved.cwd, "/Users/maddie/project");
  assert.equal(approved.command, "npm test");
  assert.equal(approved.id, request.id);
  assert.equal(approved.requesterUserId, request.requesterUserId);
});

test("approved terminal requests require a room project and command", () => {
  assert.throws(() => terminalRequestForApprovedRun(request, " "), /Room project path/);
  assert.throws(
    () => terminalRequestForApprovedRun({ ...request, command: " " }, "/Users/maddie/project"),
    /Terminal request command/
  );
});

test("terminal request actions require a pending request from the current room list", () => {
  const requests = [request, { ...request, id: "terminal-request-2", status: "approved" as const }];

  assert.deepEqual(findRoomTerminalRequest(requests, request.id), request);
  assert.equal(canActOnRoomTerminalRequest(requests, request.id), true);
  assert.equal(canActOnRoomTerminalRequest(requests, "terminal-request-2"), false);
  assert.equal(canActOnRoomTerminalRequest(requests, "missing"), false);
  assert.equal(
    roomTerminalRequestMessage(requests, "terminal-request-2"),
    "Terminal request is approved, not pending."
  );
  assert.equal(
    roomTerminalRequestMessage(requests, "missing"),
    "Terminal request is no longer available in this room."
  );
});

test("terminal action in-flight guard is scoped to one room", () => {
  assert.equal(isRoomTerminalActionInFlight({ "room-a": true }, "room-a"), true);
  assert.equal(isRoomTerminalActionInFlight({ "room-a": true }, "room-b"), false);
  assert.equal(isRoomTerminalActionInFlight({ "room-a": false }, "room-a"), false);
  assert.equal(roomTerminalActionInFlightMessage(), "A terminal action is already running in this room.");
});
