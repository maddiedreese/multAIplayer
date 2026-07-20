import assert from "node:assert/strict";
import test from "node:test";
import {
  findReleaseByTag,
  isPrereleaseTag,
  planChannelUpdate,
  retryReleaseLookup,
  validateReleaseEvent
} from "./github-release.mjs";

test("draft releases can be resolved from the authenticated releases list", () => {
  const draft = { id: 7, draft: true, tag_name: "v0.1.0-alpha.7" };
  assert.equal(findReleaseByTag([{ id: 6, draft: false, tag_name: "v0.1.0-alpha.6" }, draft], draft.tag_name), draft);
  assert.equal(findReleaseByTag([], draft.tag_name), null);
  assert.throws(() => findReleaseByTag([draft, { ...draft, id: 8 }], draft.tag_name), /multiple releases/);
});

test("new draft visibility retries are bounded and stop at the first visible release", () => {
  const draft = { id: 7, draft: true, tag_name: "v0.1.0-alpha.7" };
  let lookups = 0;
  let waits = 0;
  assert.equal(
    retryReleaseLookup(
      () => (++lookups < 3 ? null : draft),
      () => {
        waits += 1;
      }
    ),
    draft
  );
  assert.equal(lookups, 3);
  assert.equal(waits, 2);

  lookups = 0;
  assert.equal(retryReleaseLookup(() => (++lookups, null), () => {}, 2), null);
  assert.equal(lookups, 2);
  assert.throws(() => retryReleaseLookup(() => null, () => {}, 0), /attempts must be positive/);
});

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
