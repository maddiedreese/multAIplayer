import assert from "node:assert/strict";
import test from "node:test";
import { isPrereleaseTag, planChannelUpdate, validateReleaseEvent } from "./github-release.mjs";

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

test("release source events accept manual dispatch from a branch but bind tag pushes exactly", () => {
  const tagCommitSha = "a".repeat(40);
  assert.doesNotThrow(() =>
    validateReleaseEvent({
      eventName: "workflow_dispatch",
      eventRef: "refs/heads/main",
      eventSha: "b".repeat(40),
      tag: "v0.1.0-alpha.0",
      tagCommitSha
    })
  );
  assert.doesNotThrow(() =>
    validateReleaseEvent({
      eventName: "push",
      eventRef: "refs/tags/v0.1.0-alpha.0",
      eventSha: tagCommitSha,
      tag: "v0.1.0-alpha.0",
      tagCommitSha
    })
  );
  assert.throws(
    () =>
      validateReleaseEvent({
        eventName: "push",
        eventRef: "refs/heads/main",
        eventSha: tagCommitSha,
        tag: "v0.1.0-alpha.0",
        tagCommitSha
      }),
    /release workflow ref/
  );
});
