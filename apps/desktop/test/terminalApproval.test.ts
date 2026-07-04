import assert from "node:assert/strict";
import test from "node:test";
import { terminalRequestForApprovedRun } from "../src/lib/terminalApproval";

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
