import assert from "node:assert/strict";
import test from "node:test";
import {
  PendingInviteWaitRegistry,
  runOwnedPendingInviteRecovery,
  type PendingInviteWaitOwnership
} from "../src/lib/invite/pendingInviteWaitRegistry.ts";

test("a stale observed recovery cannot reclaim a terminal foreground wait", () => {
  const registry = new PendingInviteWaitRegistry();
  const scan = registry.beginScan();
  const foreground = registry.claim("request-1");
  assert.ok(foreground);
  foreground.settle();
  foreground.release();
  const observer = scan.observe(["request-1"]).get("request-1");
  assert.ok(observer);
  scan.release();

  assert.equal(observer.claim(), null);
  assert.equal(registry.trackedCount(), 0);
});

test("a retryable wait can be reclaimed after its owner releases", () => {
  const registry = new PendingInviteWaitRegistry();
  const first = registry.claim("request-1");
  assert.ok(first);
  first.release();

  const retry = registry.claim("request-1");
  assert.ok(retry);
  retry.release();
  assert.equal(registry.trackedCount(), 0);
});

test("a deferred stale scan survives more than the former tombstone limit and drains without leaking", () => {
  const registry = new PendingInviteWaitRegistry();
  const staleScan = registry.beginScan();
  const staleForeground = registry.claim("stale-request");
  assert.ok(staleForeground);
  staleForeground.settle();
  staleForeground.release();

  for (let index = 0; index < 300; index += 1) {
    const ownership = registry.claim(`later-request-${index}`);
    assert.ok(ownership);
    ownership.settle();
    ownership.release();
  }

  const staleObserver = staleScan.observe(["stale-request"]).get("stale-request");
  assert.ok(staleObserver);
  staleScan.release();
  assert.equal(staleObserver.claim(), null);
  assert.equal(registry.trackedCount(), 0);
});

test("owned error cleanup excludes a foreground wait until the side effect drains", async () => {
  const registry = new PendingInviteWaitRegistry();
  const scan = registry.beginScan();
  const observer = scan.observe(["request-1"]).get("request-1");
  assert.ok(observer);
  scan.release();
  let beginCleanup: () => void = () => undefined;
  const cleanupStarted = new Promise<void>((resolve) => {
    beginCleanup = resolve;
  });
  let finishCleanup: () => void = () => undefined;
  const cleanupGate = new Promise<void>((resolve) => {
    finishCleanup = resolve;
  });
  const recovery = runOwnedPendingInviteRecovery({
    observer,
    load: async () => {
      throw new Error("invite not found");
    },
    recover: () => assert.fail("failed lookup must not recover"),
    onError: async (_error, ownership) => {
      beginCleanup();
      await cleanupGate;
      ownership.settle();
    }
  });

  await cleanupStarted;
  assert.equal(registry.claim("request-1"), null);
  finishCleanup();
  await recovery;
  assert.equal(registry.trackedCount(), 0);
});

test("successful recovery can transfer ownership into response polling", async () => {
  const registry = new PendingInviteWaitRegistry();
  const scan = registry.beginScan();
  const observer = scan.observe(["request-1"]).get("request-1");
  assert.ok(observer);
  scan.release();
  let transferredOwnership: PendingInviteWaitOwnership | null = null;
  await runOwnedPendingInviteRecovery({
    observer,
    load: async () => "metadata",
    recover: (_value, ownership) => {
      transferredOwnership = ownership;
      return "transfer";
    },
    onError: async () => assert.fail("successful lookup must not fail")
  });

  assert.equal(registry.claim("request-1"), null);
  assert.ok(transferredOwnership);
  transferredOwnership.settle();
  transferredOwnership.release();
  assert.equal(registry.trackedCount(), 0);
});
