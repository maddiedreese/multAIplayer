import assert from "node:assert/strict";
import test from "node:test";
import { isPrereleaseTag, planChannelUpdate } from "./github-release.mjs";

test("release tags are validated and classified without loose substring rules", () => {
  assert.equal(isPrereleaseTag("v0.1.0-alpha.1"), true);
  assert.equal(isPrereleaseTag("v1.0.0"), false);
  assert.throws(() => isPrereleaseTag("not-a-tag"), /invalid/);
});

test("updater channel planning distinguishes create, retry, update, and regression", () => {
  const alpha1 = { version: "0.1.0-alpha.1", notes: "one" };
  const alpha2 = { version: "0.1.0-alpha.2", notes: "two" };
  const bytes = (value) => JSON.stringify(value);
  assert.equal(planChannelUpdate(bytes(alpha1), null), "create");
  assert.equal(planChannelUpdate(bytes(alpha1), bytes(alpha1)), "unchanged");
  assert.equal(planChannelUpdate(bytes(alpha2), bytes(alpha1)), "update");
  assert.equal(planChannelUpdate(`${JSON.stringify(alpha1, null, 2)}\n`, bytes(alpha1)), "update");
  assert.throws(() => planChannelUpdate(bytes(alpha1), bytes(alpha2)), /regression/);
});
