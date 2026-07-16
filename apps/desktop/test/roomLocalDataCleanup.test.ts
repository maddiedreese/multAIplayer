import assert from "node:assert/strict";
import test from "node:test";
import {
  resetRoomLocalDataCleanupForTests,
  runRoomLocalDataCleanup,
  waitForRoomLocalDataCleanup
} from "../src/lib/core/roomLocalDataCleanup";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test.beforeEach(resetRoomLocalDataCleanupForTests);

test("room cleanup coalesces repeats and gates rejoin until deletion finishes", async () => {
  const deletion = deferred();
  let calls = 0;
  const first = runRoomLocalDataCleanup("room-a", () => {
    calls += 1;
    return deletion.promise;
  });
  const repeated = runRoomLocalDataCleanup("room-a", async () => {
    calls += 1;
  });
  let joined = false;
  const join = waitForRoomLocalDataCleanup("room-a").then(() => {
    joined = true;
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(joined, false);
  deletion.resolve();
  await Promise.all([first, repeated, join]);
  assert.equal(joined, true);
});

test("failed cleanup blocks rejoin until an explicit retry succeeds", async () => {
  await assert.rejects(
    runRoomLocalDataCleanup("room-a", async () => {
      throw new Error("keychain unavailable");
    }),
    /keychain unavailable/
  );
  await assert.rejects(waitForRoomLocalDataCleanup("room-a"), /must be retried/);
  await runRoomLocalDataCleanup("room-a", async () => undefined);
  await waitForRoomLocalDataCleanup("room-a");
});
