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

test("a later successful snapshot reports scoped write recovery", async () => {
  const events: string[] = [];
  let attempts = 0;
  const queue = new LocalHistoryWriteQueue(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("disk unavailable");
  });
  queue.queue(
    "room-a",
    { revision: 1 },
    () => events.push("failed"),
    () => events.push("saved-1")
  );
  await assert.rejects(queue.flush("room-a"));
  queue.queue(
    "room-a",
    { revision: 2 },
    () => events.push("failed-again"),
    () => events.push("recovered")
  );
  await queue.flush("room-a");
  assert.deepEqual(events, ["failed", "recovered"]);
});

test("flush surfaces an unrecovered write failure and a later successful snapshot clears it", async () => {
  let fail = true;
  const queue = new LocalHistoryWriteQueue(async () => {
    if (fail) throw new Error("disk unavailable");
  });
  queue.queue("room-a", { revision: 1 }, () => undefined);
  await assert.rejects(queue.flush("room-a"), /encrypted local-history writes failed/i);
  fail = false;
  queue.queue("room-a", { revision: 2 }, () => undefined);
  await queue.flush("room-a");
});

test("a deletion barrier drops pending and new snapshots before deleting an active room", async () => {
  const first = deferred();
  const events: string[] = [];
  const queue = new LocalHistoryWriteQueue(async (_roomId, value) => {
    events.push(`save:${String((value as { revision: number }).revision)}`);
    await first.promise;
  });
  const unexpectedError = (error: unknown) => assert.fail(String(error));

  queue.queue("room-a", { revision: 1 }, unexpectedError);
  queue.queue("room-a", { revision: 2 }, unexpectedError);
  const deletion = queue.withBarrier("room-a", async () => {
    events.push("delete");
  });
  queue.queue("room-a", { revision: 3 }, unexpectedError);

  assert.deepEqual(events, ["save:1"]);
  first.resolve();
  await deletion;
  await queue.flush("room-a");
  assert.deepEqual(events, ["save:1", "delete"]);
});

test("a failed barrier does not strand a later room deletion", async () => {
  const expected = new Error("delete failed");
  const events: string[] = [];
  const queue = new LocalHistoryWriteQueue(async () => undefined);

  const first = queue.withBarrier("room-a", async () => {
    events.push("first");
    throw expected;
  });
  const second = queue.withBarrier("room-a", async () => {
    events.push("second");
  });

  await assert.rejects(first, expected);
  await second;
  assert.deepEqual(events, ["first", "second"]);
});

test("a successful deletion barrier retires an obsolete failed-save warning", async () => {
  const queue = new LocalHistoryWriteQueue(async () => {
    throw new Error("disk unavailable");
  });
  queue.queue("room-a", { revision: 1 }, () => undefined);
  await queue.withBarrier("room-a", async () => undefined);
  await queue.flush("room-a");
});

test("a failed deletion barrier replays the newest snapshot observed while blocked", async () => {
  const barrier = deferred();
  const saved: number[] = [];
  const queue = new LocalHistoryWriteQueue(async (_roomId, value) => {
    saved.push((value as { revision: number }).revision);
  });
  const deletion = queue.withBarrier("room-a", async () => {
    await barrier.promise;
    throw new Error("delete failed");
  });
  queue.queue("room-a", { revision: 1 }, () => undefined);
  queue.queue("room-a", { revision: 2 }, () => undefined);
  barrier.resolve();
  await assert.rejects(deletion, /delete failed/);
  await queue.flush("room-a");
  assert.deepEqual(saved, [2]);
});
