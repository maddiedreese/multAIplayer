import assert from "node:assert/strict";
import test from "node:test";
import { planReleasePublication } from "./plan-release-publication.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";

test("publication planning distinguishes missing, draft, and public releases", () => {
  assert.equal(
    planReleasePublication({ releaseMetadata: null, expectedCommit: commit, resolvedCommit: commit }),
    "create-draft"
  );
  assert.equal(
    planReleasePublication({ releaseMetadata: { draft: true }, expectedCommit: commit, resolvedCommit: commit }),
    "reconcile-draft"
  );
  assert.equal(
    planReleasePublication({ releaseMetadata: { draft: false }, expectedCommit: commit, resolvedCommit: commit }),
    "verify-public"
  );
});

test("publication planning fails before mutation when the release tag moved", () => {
  const movedCommit = "fedcba9876543210fedcba9876543210fedcba98";
  assert.throws(
    () =>
      planReleasePublication({
        releaseMetadata: { draft: true },
        expectedCommit: commit,
        resolvedCommit: movedCommit
      }),
    /release tag moved after source resolution/
  );
});

test("publication planning rejects ambiguous GitHub metadata", () => {
  assert.throws(
    () => planReleasePublication({ releaseMetadata: {}, expectedCommit: commit, resolvedCommit: commit }),
    /must identify its draft state/
  );
});
