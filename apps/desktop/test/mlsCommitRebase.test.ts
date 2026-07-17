import assert from "node:assert/strict";
import test from "node:test";
import { defaultTestRoom } from "./support/workspaceFixtures";
import { clearAndRebaseStaleMlsCommit } from "../src/lib/mls/mlsCommitRebase";

test("stale Commit rebase requests replay without polling behind the active ordered handler", async () => {
  const order: string[] = [];
  const client = {
    publish: () => undefined,
    publishAndWaitForAck: async () => undefined,
    joinAndWaitForAck: async () => undefined,
    rejoinForBacklog: async () => {
      order.push("rejoin-acknowledged");
    },
    close: () => undefined
  } satisfies Parameters<typeof clearAndRebaseStaleMlsCommit>[0];
  await clearAndRebaseStaleMlsCommit(
    client,
    defaultTestRoom,
    { userId: "user-test", deviceId: "device-test", deviceSessionToken: "session-test" },
    "commit-stale",
    {
      clear: async () => {
        order.push("cleared");
        return 1;
      }
    }
  );
  assert.deepEqual(order, ["cleared", "rejoin-acknowledged"]);
});
