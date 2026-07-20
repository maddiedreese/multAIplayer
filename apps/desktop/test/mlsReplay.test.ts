import assert from "node:assert/strict";
import test from "node:test";
import type { MlsRelayMessage } from "@multaiplayer/protocol";
import { handleExactLocalMlsReplay } from "../src/hooks/relay/mlsReplay";

const application: MlsRelayMessage = {
  id: "message-local",
  teamId: "team-test",
  roomId: "room-test",
  senderUserId: "user-local",
  senderDeviceId: "device-local",
  createdAt: "2026-07-16T00:00:00.000Z",
  messageType: "application",
  epochHint: 1,
  mlsMessage: "AA=="
};

test("skips exact-local MLS application replay without invoking native receive", async () => {
  let recovered = false;
  assert.equal(
    await handleExactLocalMlsReplay(application, { userId: "user-local", deviceId: "device-local" }, () => {
      recovered = true;
    }),
    true
  );
  assert.equal(recovered, false);
});

test("skips an exact-local admission commit replay without invoking native receive", async () => {
  let recovered = false;
  assert.equal(
    await handleExactLocalMlsReplay(
      { ...application, id: "admission-commit-local", messageType: "commit", epochHint: 0 },
      { userId: "user-local", deviceId: "device-local" },
      () => {
        recovered = true;
      }
    ),
    true
  );
  assert.equal(recovered, false);
});

test("retains authenticated host-handoff recovery for an exact-local commit", async () => {
  const handoff: MlsRelayMessage = {
    ...application,
    messageType: "commit",
    commitEffect: "host_handoff",
    nextHostUserId: "user-next",
    nextHostDeviceId: "device-next"
  };
  const recovered: string[] = [];
  assert.equal(
    await handleExactLocalMlsReplay(handoff, { userId: "user-local", deviceId: "device-local" }, (message) => {
      recovered.push(message.id);
    }),
    true
  );
  assert.deepEqual(recovered, [handoff.id]);
});

test("routes peer and same-user other-device MLS messages through normal ordered receive", async () => {
  const recover = () => assert.fail("peer replay must not run local handoff recovery");
  assert.equal(
    await handleExactLocalMlsReplay(
      { ...application, senderUserId: "user-peer", senderDeviceId: "device-peer" },
      { userId: "user-local", deviceId: "device-local" },
      recover
    ),
    false
  );
  assert.equal(
    await handleExactLocalMlsReplay(
      { ...application, senderDeviceId: "device-other" },
      { userId: "user-local", deviceId: "device-local" },
      recover
    ),
    false
  );
});
