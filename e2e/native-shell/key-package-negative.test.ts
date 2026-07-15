import assert from "node:assert/strict";
import test from "node:test";
import { pollForRegisteredDevice } from "./key-package-negative.js";

test("device registration polling honors the relay retry window", async () => {
  let now = 0;
  const sleeps: number[] = [];
  const responses = [
    {
      status: 429,
      retryAfter: "2",
      body: { code: "rate_limited", retryAfterSeconds: 2 }
    },
    {
      status: 200,
      body: { devices: [{ userId: "guest-user", deviceId: "guest-device" }] }
    }
  ];

  const deviceId = await pollForRegisteredDevice(async () => responses.shift() ?? {}, "guest-user", {
    timeoutMs: 5_000,
    now: () => now,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      now += delayMs;
    }
  });

  assert.equal(deviceId, "guest-device");
  assert.deepEqual(sleeps, [2_000]);
});

test("device registration polling is bounded and preserves the last response in its timeout", async () => {
  let now = 0;
  let requests = 0;

  await assert.rejects(
    pollForRegisteredDevice(
      async () => {
        requests += 1;
        return { status: 503, body: { code: "relay_unavailable", message: "relay is restarting" } };
      },
      "guest-user",
      {
        timeoutMs: 2_000,
        pollIntervalMs: 750,
        now: () => now,
        sleep: async (delayMs) => {
          now += delayMs;
        }
      }
    ),
    /after 3 checks; last response: HTTP 503: relay_unavailable: relay is restarting/
  );
  assert.equal(requests, 3);
  assert.equal(now, 2_000);
});
