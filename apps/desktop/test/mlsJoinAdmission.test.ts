import assert from "node:assert/strict";
import test from "node:test";
import { completeMlsRelayAdmission, synchronizeMlsRecoverySelection } from "../src/lib/mlsJoinAdmission";

const admission = {
  inviteId: "invite-1",
  teamId: "team-1",
  roomId: "room-1",
  requestId: "request-1",
  requesterUserId: "user-1",
  requesterDeviceId: "device-1"
};

test("invite recovery synchronizes only the team of an already-selected room", () => {
  const selections: Array<[string, string]> = [];
  synchronizeMlsRecoverySelection(admission, {
    selectedTeam: "other-team",
    selectedRoomId: admission.roomId,
    selectWorkspaceRoom: (teamId, roomId) => selections.push([teamId, roomId])
  });
  assert.deepEqual(selections, [[admission.teamId, admission.roomId]]);

  synchronizeMlsRecoverySelection(admission, {
    selectedTeam: admission.teamId,
    selectedRoomId: admission.roomId,
    selectWorkspaceRoom: (teamId, roomId) => selections.push([teamId, roomId])
  });
  assert.deepEqual(selections, [[admission.teamId, admission.roomId]]);

  synchronizeMlsRecoverySelection(admission, {
    selectedTeam: "other-team",
    selectedRoomId: "other-room",
    selectWorkspaceRoom: (teamId, roomId) => selections.push([teamId, roomId])
  });
  assert.deepEqual(selections, [[admission.teamId, admission.roomId]]);
});

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

test("concurrent recovery coalesces by durable admission and only the winner updates UI", async () => {
  const calls: string[] = [];
  let releaseAcknowledgement!: () => void;
  const acknowledgementBlocked = new Promise<void>((resolve) => {
    releaseAcknowledgement = resolve;
  });
  const client = {
    publish() {},
    publishAndWaitForAck: async () => undefined,
    joinAndWaitForAck: async () => void calls.push("joined"),
    close() {}
  };
  const first = completeMlsRelayAdmission(client, admission, "session-1", () => void calls.push("winner-ui"), {
    acknowledge: async () => {
      calls.push("ack");
      await acknowledgementBlocked;
    },
    complete: async () => void calls.push("clear")
  });
  const second = completeMlsRelayAdmission(client, admission, "session-1", () => void calls.push("loser-ui"), {
    acknowledge: async () => void calls.push("duplicate-ack"),
    complete: async () => void calls.push("duplicate-clear")
  });

  assert.equal(second, first);
  assert.deepEqual(calls, ["ack"]);
  releaseAcknowledgement();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["ack", "joined", "winner-ui", "clear"]);

  await completeMlsRelayAdmission(client, admission, "session-1", () => void calls.push("retry-ui"), {
    acknowledge: async () => void calls.push("retry-ack"),
    complete: async () => void calls.push("retry-clear")
  });
  assert.deepEqual(calls.slice(-4), ["retry-ack", "joined", "retry-ui", "retry-clear"]);
});
