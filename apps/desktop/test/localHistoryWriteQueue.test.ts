import assert from "node:assert/strict";
import test from "node:test";
import { LocalHistoryWriteQueue } from "../src/lib/history/localHistoryWriteQueue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("history writes are serialized per room and bursts retain the newest snapshot", async () => {
  const first = deferred();
  const calls: Array<{ roomId: string; value: unknown }> = [];
  const queue = new LocalHistoryWriteQueue(async (roomId, value) => {
    calls.push({ roomId, value });
    if (calls.length === 1) await first.promise;
  });

  const unexpectedError = (error: unknown) => assert.fail(String(error));
  queue.queue("room-a", { revision: 1 }, unexpectedError);
  queue.queue("room-a", { revision: 2 }, unexpectedError);
  queue.queue("room-a", { revision: 3 }, unexpectedError);
  assert.deepEqual(calls, [{ roomId: "room-a", value: { revision: 1 } }]);

  first.resolve();
  await queue.flush("room-a");
  assert.deepEqual(calls, [
    { roomId: "room-a", value: { revision: 1 } },
    { roomId: "room-a", value: { revision: 3 } }
  ]);
});

test("a failed history write reports the error and does not strand the next snapshot", async () => {
  const expected = new Error("disk unavailable");
  const errors: unknown[] = [];
  let attempts = 0;
  const queue = new LocalHistoryWriteQueue(async () => {
    attempts += 1;
    if (attempts === 1) throw expected;
  });

  queue.queue("room-a", { revision: 1 }, (error) => errors.push(error));
  queue.queue("room-a", { revision: 2 }, (error) => errors.push(error));
  await queue.flush("room-a");

  assert.deepEqual(errors, [expected]);
  assert.equal(attempts, 2);
});
