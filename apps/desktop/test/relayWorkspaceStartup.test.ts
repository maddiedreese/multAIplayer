import assert from "node:assert/strict";
import test from "node:test";
import {
  canContinueSelectedWorkspaceAfterAdmissionRecovery,
  runRelayWorkspaceStartupBarrier
} from "../src/lib/relay/relayWorkspaceStartup";

test("workspace startup defers team and room continuation until admission recovery completes", async () => {
  const calls: string[] = [];
  let finishRecovery: () => void = () => undefined;
  const recoveryGate = new Promise<void>((resolve) => {
    finishRecovery = resolve;
  });
  const startup = runRelayWorkspaceStartupBarrier({
    recoverAdmissions: async () => {
      calls.push("recover");
      await recoveryGate;
    },
    continueSelection: () => calls.push("continue"),
    onRecoveryFailure: () => calls.push("failure")
  });

  await Promise.resolve();
  assert.deepEqual(calls, ["recover"]);
  finishRecovery();
  assert.equal(await startup, true);
  assert.deepEqual(calls, ["recover", "continue"]);
});

test("workspace startup continues immediately when admission recovery has no work", async () => {
  const calls: string[] = [];
  assert.equal(
    await runRelayWorkspaceStartupBarrier({
      recoverAdmissions: async () => void calls.push("recover"),
      continueSelection: () => calls.push("continue"),
      onRecoveryFailure: () => calls.push("failure")
    }),
    true
  );
  assert.deepEqual(calls, ["recover", "continue"]);
});

test("failed admission recovery blocks selection continuation and remains retryable", async () => {
  const calls: string[] = [];
  let attempts = 0;
  const options = {
    recoverAdmissions: async () => {
      attempts += 1;
      calls.push(`recover-${attempts}`);
      if (attempts === 1) throw new Error("relay interrupted");
    },
    continueSelection: () => calls.push("continue"),
    onRecoveryFailure: () => calls.push("failure")
  };

  assert.equal(await runRelayWorkspaceStartupBarrier(options), false);
  assert.deepEqual(calls, ["recover-1", "failure"]);
  assert.equal(await runRelayWorkspaceStartupBarrier(options), true);
  assert.deepEqual(calls, ["recover-1", "failure", "recover-2", "continue"]);
});

test("an obsolete reconnect recovery cannot continue or publish failure state", async () => {
  const calls: string[] = [];
  let current = true;
  let finishRecovery: () => void = () => undefined;
  const recoveryGate = new Promise<void>((resolve) => {
    finishRecovery = resolve;
  });
  const startup = runRelayWorkspaceStartupBarrier({
    recoverAdmissions: async () => {
      calls.push("recover");
      await recoveryGate;
    },
    continueSelection: () => calls.push("continue"),
    onRecoveryFailure: () => calls.push("failure"),
    isCurrent: () => current
  });

  await Promise.resolve();
  current = false;
  finishRecovery();
  assert.equal(await startup, false);
  assert.deepEqual(calls, ["recover"]);

  current = true;
  const failedStartup = runRelayWorkspaceStartupBarrier({
    recoverAdmissions: async () => {
      calls.push("recover-failure");
      await Promise.resolve();
      current = false;
      throw new Error("old socket closed");
    },
    continueSelection: () => calls.push("continue-failure"),
    onRecoveryFailure: () => calls.push("failure-obsolete"),
    isCurrent: () => current
  });
  assert.equal(await failedStartup, false);
  assert.deepEqual(calls, ["recover", "recover-failure"]);
});

test("admission failures block only the selected authorization boundary", () => {
  const failedAdmissions = [{ teamId: "team-pending", roomId: "room-pending" }];

  assert.equal(
    canContinueSelectedWorkspaceAfterAdmissionRecovery({
      failedAdmissions,
      selectedTeamId: "team-pending",
      selectedRoomId: "room-pending"
    }),
    false
  );
  assert.equal(
    canContinueSelectedWorkspaceAfterAdmissionRecovery({
      failedAdmissions,
      selectedTeamId: "team-ready",
      selectedRoomId: "room-ready"
    }),
    true
  );
  assert.equal(
    canContinueSelectedWorkspaceAfterAdmissionRecovery({
      failedAdmissions,
      selectedTeamId: "team-pending",
      selectedRoomId: "room-already-authorized"
    }),
    true
  );
  assert.equal(
    canContinueSelectedWorkspaceAfterAdmissionRecovery({
      failedAdmissions,
      selectedTeamId: "team-pending",
      selectedRoomId: null
    }),
    false
  );
  assert.equal(
    canContinueSelectedWorkspaceAfterAdmissionRecovery({
      failedAdmissions,
      selectedTeamId: "team-ready",
      selectedRoomId: null
    }),
    true
  );
});
