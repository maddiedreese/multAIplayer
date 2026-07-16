import assert from "node:assert/strict";
import test from "node:test";
import { installLocalHistoryCloseDrain } from "../src/lib/history/localHistoryCloseDrain";

function closeHarness() {
  let handler: ((event: { preventDefault: () => void }) => void | Promise<void>) | undefined;
  let closeCalls = 0;
  return {
    appWindow: {
      onCloseRequested: async (next: typeof handler) => {
        handler = next;
        return () => {
          handler = undefined;
        };
      },
      close: async () => {
        closeCalls += 1;
      }
    },
    requestClose: async () => {
      let prevented = false;
      await handler?.({ preventDefault: () => (prevented = true) });
      return prevented;
    },
    closeCalls: () => closeCalls
  };
}

test("close drain waits for pending encrypted history before closing", async () => {
  const harness = closeHarness();
  const events: string[] = [];
  await installLocalHistoryCloseDrain({
    appWindow: harness.appWindow,
    prepare: () => ({ token: "snapshot-1", enqueue: () => undefined }),
    flush: async () => void events.push("flush"),
    reportFailure: (message) => events.push(message)
  });
  assert.equal(await harness.requestClose(), true);
  assert.deepEqual(events, ["flush"]);
  assert.equal(harness.closeCalls(), 1);
});

test("failed close drain stays open, warns, and requires a second explicit close", async () => {
  const harness = closeHarness();
  const failures: string[] = [];
  await installLocalHistoryCloseDrain({
    appWindow: harness.appWindow,
    prepare: () => ({ token: "snapshot-1", enqueue: () => undefined }),
    flush: async () => {
      throw new Error("disk full");
    },
    reportFailure: (message) => failures.push(message)
  });
  assert.equal(await harness.requestClose(), true);
  assert.equal(harness.closeCalls(), 0);
  assert.match(failures[0] ?? "", /clos(?:e|ing) again/i);
  assert.equal(await harness.requestClose(), true);
  assert.equal(harness.closeCalls(), 1);
});

test("repeated close requests share one bounded history drain", async () => {
  const harness = closeHarness();
  let release!: () => void;
  let flushCalls = 0;
  await installLocalHistoryCloseDrain({
    appWindow: harness.appWindow,
    prepare: () => ({ token: "snapshot-1", enqueue: () => undefined }),
    flush: () => {
      flushCalls += 1;
      return new Promise<void>((resolve) => (release = resolve));
    },
    reportFailure: () => undefined
  });
  const first = harness.requestClose();
  await Promise.resolve();
  assert.equal(await harness.requestClose(), true);
  assert.equal(flushCalls, 1);
  assert.equal(harness.closeCalls(), 0);
  release();
  await first;
  assert.equal(harness.closeCalls(), 1);
});

test("a timed-out history drain remains open and reports a bounded failure", async () => {
  const harness = closeHarness();
  const failures: string[] = [];
  await installLocalHistoryCloseDrain({
    appWindow: harness.appWindow,
    prepare: () => ({ token: "snapshot-1", enqueue: () => undefined }),
    flush: () => new Promise<void>(() => undefined),
    reportFailure: (message) => failures.push(message),
    timeoutMs: 5
  });
  assert.equal(await harness.requestClose(), true);
  assert.equal(harness.closeCalls(), 0);
  assert.match(failures[0] ?? "", /close again/i);
});

test("continued work resets immediate abandonment and requires a fresh drain", async () => {
  const harness = closeHarness();
  let token = "snapshot-1";
  let flushCalls = 0;
  await installLocalHistoryCloseDrain({
    appWindow: harness.appWindow,
    prepare: () => ({ token, enqueue: () => undefined }),
    flush: async () => {
      flushCalls += 1;
      if (flushCalls === 1) throw new Error("disk busy");
    },
    reportFailure: () => undefined
  });
  await harness.requestClose();
  token = "snapshot-2";
  await harness.requestClose();
  assert.equal(flushCalls, 2);
  assert.equal(harness.closeCalls(), 1);
});

test("an expired abandonment attempt retries the drain even when state is unchanged", async () => {
  const harness = closeHarness();
  let clock = 0;
  let flushCalls = 0;
  await installLocalHistoryCloseDrain({
    appWindow: harness.appWindow,
    prepare: () => ({ token: "snapshot-1", enqueue: () => undefined }),
    flush: async () => {
      flushCalls += 1;
      if (flushCalls === 1) throw new Error("disk busy");
    },
    reportFailure: () => undefined,
    abandonWindowMs: 10,
    now: () => clock
  });
  await harness.requestClose();
  clock = 11;
  await harness.requestClose();
  assert.equal(flushCalls, 2);
  assert.equal(harness.closeCalls(), 1);
});
