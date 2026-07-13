import assert from "node:assert/strict";
import test from "node:test";
import { completeMlsRelayAdmission } from "../src/lib/mlsJoinAdmission";

const admission = {
  inviteId: "invite-1",
  teamId: "team-1",
  roomId: "room-1",
  requestId: "request-1",
  requesterUserId: "user-1",
  requesterDeviceId: "device-1"
};

test("admission recovery preserves ACK, joined, native-clear ordering", async () => {
  const calls: string[] = [];
  const client = {
    publish() {},
    publishAndWaitForAck: async () => undefined,
    joinAndWaitForAck: async () => void calls.push("joined"),
    close() {}
  };
  await completeMlsRelayAdmission(client, admission, "session-1", () => void calls.push("restore"), {
    acknowledge: async () => void calls.push("ack"),
    complete: async () => void calls.push("clear")
  });
  assert.deepEqual(calls, ["ack", "joined", "restore", "clear"]);
});

test("failed relay join retains the native admission receipt", async () => {
  const calls: string[] = [];
  const client = {
    publish() {},
    publishAndWaitForAck: async () => undefined,
    joinAndWaitForAck: async () => {
      calls.push("joined");
      throw new Error("offline");
    },
    close() {}
  };
  await assert.rejects(
    completeMlsRelayAdmission(client, admission, "session-1", () => void calls.push("restore"), {
      acknowledge: async () => void calls.push("ack"),
      complete: async () => void calls.push("clear")
    }),
    /offline/
  );
  assert.deepEqual(calls, ["ack", "joined"]);
});

test("failed local restore retains the native admission receipt", async () => {
  const calls: string[] = [];
  const client = {
    publish() {},
    publishAndWaitForAck: async () => undefined,
    joinAndWaitForAck: async () => void calls.push("joined"),
    close() {}
  };
  await assert.rejects(
    completeMlsRelayAdmission(
      client,
      admission,
      "session-1",
      async () => {
        calls.push("restore");
        throw new Error("storage unavailable");
      },
      {
        acknowledge: async () => void calls.push("ack"),
        complete: async () => void calls.push("clear")
      }
    ),
    /storage unavailable/
  );
  assert.deepEqual(calls, ["ack", "joined", "restore"]);
});
