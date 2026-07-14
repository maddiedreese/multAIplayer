import assert from "node:assert/strict";
import test from "node:test";
import { assertPendingInviteRecoveryContext } from "../src/lib/invite/inviteJoinActions";
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
