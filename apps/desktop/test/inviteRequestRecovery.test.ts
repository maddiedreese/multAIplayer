import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInviteHostDevice,
  assertPendingInviteRecoveryContext,
  loadResumablePendingInvites,
  pendingInviteHasMatchingAdmission
} from "../src/lib/invite/inviteJoinActions";
import { inviteRequesterDeviceMatches } from "../src/lib/invite/inviteRelayActions";
import type { PendingMlsInviteRequest } from "../src/lib/mlsClient";

const pending: PendingMlsInviteRequest = {
  inviteId: "invite-1",
  teamId: "team-1",
  roomId: "room-1",
  requestId: "request-1",
  requesterUserId: "guest-user",
  requesterDeviceId: "guest-device",
  keyPackageId: "package-1",
  keyPackageHash: "sha256:package",
  expiresAt: "2030-01-01T00:00:00.000Z",
  sealedRequest: "opaque-sealed-request"
};

const metadata = {
  invite: { id: "invite-1", teamId: "team-1", roomId: "room-1" },
  room: { id: "room-1", teamId: "team-1" }
};

test("accepts pending invite recovery only for the exact identity and relay route", () => {
  assert.doesNotThrow(() =>
    assertPendingInviteRecoveryContext(pending, { userId: "guest-user", deviceId: "guest-device" }, metadata as never)
  );
});

test("fails closed when pending recovery identity or relay metadata differs", () => {
  assert.throws(
    () =>
      assertPendingInviteRecoveryContext(
        pending,
        { userId: "other-user", deviceId: "guest-device" },
        metadata as never
      ),
    /does not match this device or relay invite metadata/
  );
  assert.throws(
    () =>
      assertPendingInviteRecoveryContext(pending, { userId: "guest-user", deviceId: "guest-device" }, {
        ...metadata,
        invite: { ...metadata.invite, roomId: "other-room" }
      } as never),
    /does not match this device or relay invite metadata/
  );
});

const protectedHost = {
  hostUserId: "host-user",
  hostDeviceId: "host-device",
  hostHpkePublicKey: "host-hpke-key",
  hostHpkeKeyFingerprint: "sha256:host-hpke"
};
const inviteHostDevice = {
  userId: "host-user",
  deviceId: "host-device",
  signaturePublicKey: "host-signature-key",
  signatureKeyFingerprint: "sha256:host-signature",
  hpkePublicKey: "host-hpke-key",
  hpkeKeyFingerprint: "sha256:host-hpke"
};

test("accepts only the invite-scoped active-host device pinned by the protected fragment", () => {
  assert.doesNotThrow(() => assertInviteHostDevice(protectedHost, { hostDevice: inviteHostDevice }));
  for (const hostDevice of [
    null,
    { ...inviteHostDevice, userId: "other-host" },
    { ...inviteHostDevice, deviceId: "other-device" },
    { ...inviteHostDevice, hpkePublicKey: "other-key" },
    { ...inviteHostDevice, hpkeKeyFingerprint: "sha256:other" }
  ]) {
    assert.throws(
      () => assertInviteHostDevice(protectedHost, { hostDevice }),
      /host HPKE key does not match the registered device/
    );
  }
});

test("host accepts only the request-scoped registered device pinned by the HPKE payload", () => {
  const protectedRequest = {
    requesterSignaturePublicKey: "requester-signature-key",
    requesterSignatureKeyFingerprint: "sha256:requester-signature"
  };
  const record = {
    requesterUserId: "requester-user",
    requesterDeviceId: "requester-device",
    requesterDevice: {
      userId: "requester-user",
      deviceId: "requester-device",
      signaturePublicKey: "requester-signature-key",
      signatureKeyFingerprint: "sha256:requester-signature"
    }
  };
  assert.equal(inviteRequesterDeviceMatches(record, protectedRequest), true);
  for (const requesterDevice of [
    null,
    { ...record.requesterDevice, userId: "other-user" },
    { ...record.requesterDevice, deviceId: "other-device" },
    { ...record.requesterDevice, signaturePublicKey: "other-key" },
    { ...record.requesterDevice, signatureKeyFingerprint: "sha256:other" }
  ]) {
    assert.equal(inviteRequesterDeviceMatches({ ...record, requesterDevice }, protectedRequest), false);
  }
});

test("a durable admission supersedes only its exact pending invite request", () => {
  const admission = {
    inviteId: pending.inviteId,
    teamId: pending.teamId,
    roomId: pending.roomId,
    requestId: pending.requestId,
    requesterUserId: pending.requesterUserId,
    requesterDeviceId: pending.requesterDeviceId
  };
  assert.equal(pendingInviteHasMatchingAdmission(pending, [admission]), true);
  for (const candidate of [
    { ...admission, inviteId: "other-invite" },
    { ...admission, teamId: "other-team" },
    { ...admission, roomId: "other-room" },
    { ...admission, requestId: "other-request" },
    { ...admission, requesterUserId: "other-user" },
    { ...admission, requesterDeviceId: "other-device" }
  ]) {
    assert.equal(pendingInviteHasMatchingAdmission(pending, [candidate]), false);
  }
});

test("pending recovery snapshots admissions first and skips admitted or already-active requests", async () => {
  const order: string[] = [];
  const otherPending = { ...pending, inviteId: "invite-2", requestId: "request-2" };
  const activePending = { ...pending, inviteId: "invite-3", requestId: "request-3" };
  const admission = {
    inviteId: pending.inviteId,
    teamId: pending.teamId,
    roomId: pending.roomId,
    requestId: pending.requestId,
    requesterUserId: pending.requesterUserId,
    requesterDeviceId: pending.requesterDeviceId
  };

  const result = await loadResumablePendingInvites(
    async () => {
      order.push("admissions");
      return [admission];
    },
    async () => {
      order.push("pending");
      return [pending, activePending, otherPending];
    },
    (requestId) => requestId === activePending.requestId
  );

  assert.deepEqual(order, ["admissions", "pending"]);
  assert.deepEqual(result, [otherPending]);
});
