import assert from "node:assert/strict";
import test from "node:test";
import {
  completeMlsRelayAdmission,
  coordinateMlsAdmissionRecovery,
  coordinateMlsAdmissionRecoveryWithRetry,
  projectMlsAdmissionInviteRequest,
  synchronizeMlsRecoverySelection
} from "../src/lib/mlsJoinAdmission";
import type { InviteJoinRequest } from "../src/types";

const admission = {
  inviteId: "invite-1",
  teamId: "team-1",
  roomId: "room-1",
  requestId: "request-1",
  requesterUserId: "user-1",
  requesterDeviceId: "device-1"
};

const pending = {
  ...admission,
  keyPackageId: "package-1",
  keyPackageHash: "sha256:package",
  expiresAt: "2030-01-01T00:00:00.000Z",
  sealedRequest: "opaque-request"
};

const localRequest: InviteJoinRequest = {
  id: pending.requestId,
  inviteId: pending.inviteId,
  requester: "Guest",
  requesterUserId: pending.requesterUserId,
  requesterDeviceId: pending.requesterDeviceId,
  keyPackageId: pending.keyPackageId,
  keyPackageHash: pending.keyPackageHash,
  requestedAt: "2026-07-14T00:00:00.000Z",
  note: "Requesting access.",
  status: "pending"
};

test("admission recovery reconstructs a missing local request before approving it", () => {
  const calls: string[] = [];
  let appended: InviteJoinRequest | null = null;
  const result = projectMlsAdmissionInviteRequest({
    admission,
    pendingRequests: [pending],
    existingRequests: [],
    requesterName: "Guest",
    roomName: "Project room",
    requestedAt: "2026-07-14T00:00:00.000Z",
    append: (_roomId, request) => {
      calls.push("append");
      appended = request;
    },
    approve: () => calls.push("approve")
  });

  assert.deepEqual(calls, ["append", "approve"]);
  assert.equal(result, "reconstructed");
  assert.deepEqual(appended, {
    ...localRequest,
    note: "Recovering approved access to Project room."
  });
});

test("admission recovery deduplicates an exact existing local request", () => {
  const calls: string[] = [];
  const result = projectMlsAdmissionInviteRequest({
    admission,
    pendingRequests: [pending],
    existingRequests: [localRequest],
    requesterName: "Guest",
    roomName: "Project room",
    append: () => calls.push("append"),
    approve: () => calls.push("approve")
  });
  assert.deepEqual(calls, ["approve"]);
  assert.equal(result, "existing");
});

test("admission recovery approves an exact existing request after foreground pending cleanup", () => {
  const calls: string[] = [];
  const result = projectMlsAdmissionInviteRequest({
    admission,
    pendingRequests: [],
    existingRequests: [localRequest],
    requesterName: "Guest",
    roomName: "Project room",
    append: () => calls.push("append"),
    approve: () => calls.push("approve")
  });
  assert.deepEqual(calls, ["approve"]);
  assert.equal(result, "existing");
});

test("admission recovery fails closed on pending or local request mismatches", () => {
  const mutated: string[] = [];
  const invoke = (pendingRequests: (typeof pending)[], existingRequests: InviteJoinRequest[]) =>
    projectMlsAdmissionInviteRequest({
      admission,
      pendingRequests,
      existingRequests,
      requesterName: "Guest",
      roomName: "Project room",
      append: () => mutated.push("append"),
      approve: () => mutated.push("approve")
    });

  assert.equal(invoke([{ ...pending, teamId: "other-team" }], []), "unavailable");
  assert.equal(invoke([], []), "unavailable");
  assert.equal(invoke([], [{ ...localRequest, inviteId: "other-invite" }]), "unavailable");
  assert.equal(invoke([pending], [{ ...localRequest, keyPackageHash: "sha256:other" }]), "unavailable");
  assert.deepEqual(mutated, []);
});

test("admission coordinator awaits a deferred projection snapshot before completion", async () => {
  const calls: string[] = [];
  let resolvePending: (requests: (typeof pending)[]) => void = () => undefined;
  const pendingSnapshot = new Promise<(typeof pending)[]>((resolve) => {
    resolvePending = resolve;
  });
  const recovery = coordinateMlsAdmissionRecovery({
    admissions: [admission],
    requesterUserId: admission.requesterUserId,
    requesterDeviceId: admission.requesterDeviceId,
    loadPendingRequests: async () => {
      calls.push("snapshot");
      return pendingSnapshot;
    },
    complete: async (_admission, pendingRequests) => {
      assert.deepEqual(pendingRequests, [pending]);
      calls.push("complete");
    }
  });

  await Promise.resolve();
  assert.deepEqual(calls, ["snapshot"]);
  resolvePending([pending]);
  assert.deepEqual(await recovery, { attempted: 1, completed: 1, failed: 0, failedAdmissions: [] });
  assert.deepEqual(calls, ["snapshot", "complete"]);
});

test("admission coordinator completes after a rejected projection snapshot without fabricating UI", async () => {
  const calls: string[] = [];
  const result = await coordinateMlsAdmissionRecovery({
    admissions: [admission],
    requesterUserId: admission.requesterUserId,
    requesterDeviceId: admission.requesterDeviceId,
    loadPendingRequests: async () => {
      calls.push("snapshot");
      throw new Error("native snapshot unavailable");
    },
    complete: async (recoveredAdmission, pendingRequests) => {
      const projection = projectMlsAdmissionInviteRequest({
        admission: recoveredAdmission,
        pendingRequests,
        existingRequests: [],
        requesterName: "Guest",
        roomName: "Project room",
        append: () => calls.push("append"),
        approve: () => calls.push("approve")
      });
      assert.equal(projection, "unavailable");
      calls.push("complete");
    }
  });

  assert.deepEqual(result, { attempted: 1, completed: 1, failed: 0, failedAdmissions: [] });
  assert.deepEqual(calls, ["snapshot", "complete"]);
});

test("admission coordinator skips projection I/O when no admission belongs to this device", async () => {
  const calls: string[] = [];
  const result = await coordinateMlsAdmissionRecovery({
    admissions: [{ ...admission, requesterDeviceId: "other-device" }],
    requesterUserId: admission.requesterUserId,
    requesterDeviceId: admission.requesterDeviceId,
    loadPendingRequests: async () => {
      calls.push("snapshot");
      return [];
    },
    complete: async () => calls.push("complete")
  });
  assert.deepEqual(result, { attempted: 0, completed: 0, failed: 0, failedAdmissions: [] });
  assert.deepEqual(calls, []);
});

test("admission coordinator scopes failures by room and preserves other successes", async () => {
  const secondAdmission = {
    ...admission,
    inviteId: "invite-2",
    roomId: "room-2",
    requestId: "request-2"
  };
  const calls: string[] = [];
  const result = await coordinateMlsAdmissionRecovery({
    admissions: [admission, secondAdmission],
    requesterUserId: admission.requesterUserId,
    requesterDeviceId: admission.requesterDeviceId,
    loadPendingRequests: async () => [],
    complete: async (candidate) => {
      calls.push(`complete:${candidate.roomId}`);
      if (candidate.roomId === admission.roomId) throw new Error("relay interrupted");
    },
    onFailure: (candidate) => calls.push(`failure:${candidate.roomId}`)
  });

  assert.deepEqual(result, {
    attempted: 2,
    completed: 1,
    failed: 1,
    failedAdmissions: [admission]
  });
  assert.deepEqual(calls, ["complete:room-1", "failure:room-1", "complete:room-2"]);
});

test("a new socket retries after inheriting an obsolete coalesced completion", async () => {
  const calls: string[] = [];
  let releaseOld: () => void = () => undefined;
  let markOldStarted: () => void = () => undefined;
  const oldStarted = new Promise<void>((resolve) => {
    markOldStarted = resolve;
  });
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const client = {
    publish() {},
    publishAndWaitForAck: async () => undefined,
    joinAndWaitForAck: async () => void calls.push("joined"),
    close() {}
  };
  const dependencies = {
    acknowledge: async () => void calls.push("ack"),
    complete: async () => void calls.push("clear")
  };
  const obsolete = completeMlsRelayAdmission(
    client,
    admission,
    "session-1",
    async () => {
      calls.push("old-before-complete");
      markOldStarted();
      await oldGate;
      throw new Error("old socket superseded");
    },
    dependencies
  );
  await oldStarted;

  const recovered = coordinateMlsAdmissionRecoveryWithRetry({
    admissions: [admission],
    requesterUserId: admission.requesterUserId,
    requesterDeviceId: admission.requesterDeviceId,
    loadPendingRequests: async () => [],
    complete: async (candidate) =>
      completeMlsRelayAdmission(
        client,
        candidate,
        "session-1",
        () => void calls.push("new-before-complete"),
        dependencies
      )
  });
  releaseOld();

  await assert.rejects(obsolete, /old socket superseded/);
  assert.deepEqual(await recovered, {
    attempted: 1,
    completed: 1,
    failed: 0,
    failedAdmissions: []
  });
  assert.deepEqual(calls, ["ack", "joined", "old-before-complete", "ack", "joined", "new-before-complete", "clear"]);
});

test("bounded recovery retries only failed admissions and counts eventual successes once", async () => {
  const secondAdmission = {
    ...admission,
    inviteId: "invite-2",
    roomId: "room-2",
    requestId: "request-2"
  };
  const attempts = new Map<string, number>();
  const result = await coordinateMlsAdmissionRecoveryWithRetry({
    admissions: [admission, secondAdmission],
    requesterUserId: admission.requesterUserId,
    requesterDeviceId: admission.requesterDeviceId,
    loadPendingRequests: async () => [],
    complete: async (candidate) => {
      const attempt = (attempts.get(candidate.roomId) ?? 0) + 1;
      attempts.set(candidate.roomId, attempt);
      if (candidate.roomId === admission.roomId && attempt === 1) {
        throw new Error("coalesced old-socket rejection");
      }
    }
  });

  assert.deepEqual(result, {
    attempted: 2,
    completed: 2,
    failed: 0,
    failedAdmissions: []
  });
  assert.deepEqual(Object.fromEntries(attempts), { "room-1": 2, "room-2": 1 });
});

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
