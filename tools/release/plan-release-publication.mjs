#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const commitPattern = /^[0-9a-f]{40}$/;

export function planReleasePublication({ releaseMetadata, expectedCommit, resolvedCommit }) {
  assert.match(expectedCommit, commitPattern, "expected release commit must be a full lowercase Git SHA");
  assert.match(resolvedCommit, commitPattern, "resolved release commit must be a full lowercase Git SHA");
  assert.equal(
    resolvedCommit,
    expectedCommit,
    `release tag moved after source resolution: expected ${expectedCommit}, found ${resolvedCommit}`
  );

  if (releaseMetadata === null) return "create-draft";
  assert.equal(typeof releaseMetadata, "object", "GitHub release metadata must be an object");
  assert.equal(typeof releaseMetadata.draft, "boolean", "GitHub release metadata must identify its draft state");
  return releaseMetadata.draft ? "reconcile-draft" : "verify-public";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [metadataPath, expectedCommit, resolvedCommit] = process.argv.slice(2);
  assert.ok(
    metadataPath && expectedCommit && resolvedCommit,
    "expected release metadata, expected commit, and tag commit"
  );
  const metadataJson = readFileSync(metadataPath, "utf8").trim();
  const releaseMetadata = metadataJson === "" ? null : JSON.parse(metadataJson);
  console.log(planReleasePublication({ releaseMetadata, expectedCommit, resolvedCommit }));
}
