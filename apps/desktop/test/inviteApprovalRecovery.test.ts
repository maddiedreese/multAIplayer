import assert from "node:assert/strict";
import test from "node:test";
import { assertInviteApprovalEpoch, recoverInviteApproval } from "../src/lib/invite/inviteApprovalRecovery";
import type { MlsInviteCapabilityBinding, MlsOutboxItem } from "../src/lib/mls/mlsClient";

const requestBinding: MlsInviteCapabilityBinding = {
  version: 3,
  phase: "request",
  inviteId: "invite-1",
  teamId: "team-1",
  roomId: "room-1",
  keyEpoch: 7,
  keyPackageHash: "sha256:key-package",
  requestId: "request-1",
  requestNonce: "nonce-1",
  requesterUserId: "guest-user",
  requesterDeviceId: "guest-device",
  hostUserId: "host-user",
  hostDeviceId: "host-device",
  expiresAt: "2030-01-01T00:00:00.000Z",
  status: null,
  decidedAt: null
};

const responseBinding: MlsInviteCapabilityBinding = {
  ...requestBinding,
  phase: "response",
  status: "approved",
  decidedAt: "2029-12-01T00:00:00.000Z"
};

function durableApprovalOutbox(): MlsOutboxItem[] {
  return [
    {
      id: "commit-1",
      roomId: requestBinding.roomId,
      epoch: 8,
      kind: "add",
      payload: "commit-payload",
      metadata: { type: "commit", parentEpoch: 7 }
    },
    {
      id: "welcome-1",
      roomId: requestBinding.roomId,
      epoch: 8,
      kind: "welcome",
      payload: "welcome-payload",
      metadata: {
        type: "welcome",
        inviteId: requestBinding.inviteId,
        requestId: requestBinding.requestId,
        requesterUserId: requestBinding.requesterUserId,
        requesterDeviceId: requestBinding.requesterDeviceId,
        keyPackageId: "key-package-1",
        keyPackageHash: requestBinding.keyPackageHash,
        responseBinding,
        responseMac: "response-mac"
      }
    }
  ];
}

test("recovers an exact persisted approval before applying request epoch freshness", () => {
  const approval = recoverInviteApproval(durableApprovalOutbox(), {
    requestBinding,
    keyPackageId: "key-package-1"
  });

  assert.deepEqual(approval, {
    epoch: 8,
    commitOutboxId: "commit-1",
    welcomeOutboxId: "welcome-1",
    responseBinding,
    responseMac: "response-mac"
  });
  assert.doesNotThrow(() => assertInviteApprovalEpoch(7, requestBinding.keyEpoch, approval));
  assert.throws(
    () => assertInviteApprovalEpoch(8, requestBinding.keyEpoch, approval),
    /local group epoch does not match the persisted approval/
  );
});

test("recovers after the persisted commit was acknowledged but the Welcome remains", () => {
  const approval = recoverInviteApproval(durableApprovalOutbox().slice(1), {
    requestBinding,
    keyPackageId: "key-package-1"
  });

  assert.equal(approval?.commitOutboxId, "");
  assert.equal(approval?.welcomeOutboxId, "welcome-1");
  assert.doesNotThrow(() => assertInviteApprovalEpoch(8, requestBinding.keyEpoch, approval));
  assert.throws(
    () => assertInviteApprovalEpoch(7, requestBinding.keyEpoch, approval),
    /local group epoch does not match the persisted approval/
  );
});

test("requires the original epoch only when no durable approval exists", () => {
  assert.equal(recoverInviteApproval([], { requestBinding, keyPackageId: "key-package-1" }), undefined);
  assert.doesNotThrow(() => assertInviteApprovalEpoch(7, requestBinding.keyEpoch));
  assert.throws(
    () => assertInviteApprovalEpoch(8, requestBinding.keyEpoch),
    /Invite expired after the MLS epoch changed/
  );
});

test("rejects a recovered approval when the local group has moved beyond it", () => {
  const approval = recoverInviteApproval(durableApprovalOutbox(), {
    requestBinding,
    keyPackageId: "key-package-1"
  });

  assert.throws(
    () => assertInviteApprovalEpoch(9, requestBinding.keyEpoch, approval),
    /local group epoch does not match the persisted approval/
  );
});

test("fails closed when persisted Welcome metadata differs from the authenticated request", () => {
  const outbox = durableApprovalOutbox();
  const welcome = outbox[1]!;
  if (welcome.metadata?.type !== "welcome") throw new Error("invalid test fixture");
  welcome.metadata = { ...welcome.metadata, requesterDeviceId: "attacker-device" };

  assert.throws(
    () => recoverInviteApproval(outbox, { requestBinding, keyPackageId: "key-package-1" }),
    /Welcome metadata does not match the authenticated request/
  );
});

test("fails closed when the persisted response binding or commit lineage differs", () => {
  const responseOutbox = durableApprovalOutbox();
  const welcome = responseOutbox[1]!;
  if (welcome.metadata?.type !== "welcome") throw new Error("invalid test fixture");
  welcome.metadata = {
    ...welcome.metadata,
    responseBinding: { ...welcome.metadata.responseBinding, hostDeviceId: "other-host-device" }
  };
  assert.throws(
    () => recoverInviteApproval(responseOutbox, { requestBinding, keyPackageId: "key-package-1" }),
    /response binding does not match the authenticated request/
  );

  const commitOutbox = durableApprovalOutbox();
  commitOutbox[0]!.metadata = { type: "commit", parentEpoch: 6 };
  assert.throws(
    () => recoverInviteApproval(commitOutbox, { requestBinding, keyPackageId: "key-package-1" }),
    /commit parent epoch does not match the authenticated request/
  );
});
