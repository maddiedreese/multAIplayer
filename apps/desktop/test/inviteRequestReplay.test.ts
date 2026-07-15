import assert from "node:assert/strict";
import test from "node:test";
import { retryInviteRequestReplay } from "../src/application/invite/inviteRelayActions.js";

test("retries a transient invite replay until native validation is ready", async () => {
  let attempts = 0;
  const waits: number[] = [];

  const handled = await retryInviteRequestReplay(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("native state is still hydrating");
      return attempts === 3;
    },
    [0, 100, 400, 1_000],
    async (delayMs) => {
      waits.push(delayMs);
    }
  );

  assert.equal(handled, true);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [100, 400]);
});

test("bounds retries for an invalid invite replay", async () => {
  let attempts = 0;

  const handled = await retryInviteRequestReplay(
    async () => {
      attempts += 1;
      return false;
    },
    [0, 1, 2],
    async () => undefined
  );

  assert.equal(handled, false);
  assert.equal(attempts, 3);
});

test("reports the final transient failure after bounded replay retries", async () => {
  let attempts = 0;

  await assert.rejects(
    retryInviteRequestReplay(
      async () => {
        attempts += 1;
        throw new Error(`transient failure ${attempts}`);
      },
      [0, 1],
      async () => undefined
    ),
    /transient failure 2/
  );
  assert.equal(attempts, 2);
});
