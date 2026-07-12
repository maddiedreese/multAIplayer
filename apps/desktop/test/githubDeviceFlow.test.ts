import assert from "node:assert/strict";
import { test } from "node:test";
import {
  githubDevicePollDelayMs,
  nextGitHubDevicePollIntervalSeconds,
  type GitHubDevicePollResult
} from "../src/lib/authClient";

test("GitHub device polling preserves the interval while authorization is pending", () => {
  const pending: GitHubDevicePollResult = { status: "pending" };
  assert.equal(nextGitHubDevicePollIntervalSeconds(5, pending), 5);
});

test("GitHub device polling increases its interval when GitHub requests slowdown", () => {
  const slowDown: GitHubDevicePollResult = { status: "slow_down", retryAfterSeconds: 5 };
  assert.equal(nextGitHubDevicePollIntervalSeconds(5, slowDown), 10);
  assert.equal(nextGitHubDevicePollIntervalSeconds(10, slowDown), 15);
});

test("GitHub device polling never schedules beyond code expiry", () => {
  assert.equal(githubDevicePollDelayMs(5, 12_000, 10_000), 2_000);
  assert.equal(githubDevicePollDelayMs(5, 9_000, 10_000), 0);
});
