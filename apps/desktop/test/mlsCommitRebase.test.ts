import assert from "node:assert/strict";
import test from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { clearAndRebaseStaleMlsCommit } from "../src/lib/mls/mlsCommitRebase";

test("stale Commit rebase requests replay without polling behind the active ordered handler", async () => {
  const order: string[] = [];
  const client = {
    rejoinForBacklog: async () => {
      order.push("rejoin-acknowledged");
    }
  } as Parameters<typeof clearAndRebaseStaleMlsCommit>[0];
  await clearAndRebaseStaleMlsCommit(
    client,
    { id: "room-test", teamId: "team-test" } as ClientRoomRecord,
    { userId: "user-test", deviceId: "device-test", deviceSessionToken: "session-test" },
    "commit-stale",
    {
      clear: async () => {
        order.push("cleared");
      }
    }
  );
  assert.deepEqual(order, ["cleared", "rejoin-acknowledged"]);
});
