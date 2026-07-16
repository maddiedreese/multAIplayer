import assert from "node:assert/strict";
import test from "node:test";
import { extractReleaseNotes, finalizeChangelog } from "./finalize-changelog.mjs";

const source = `# Changelog

## [Unreleased]

### Added

- A reviewed product change.

## [0.1.0-alpha.0] - 2026-07-04
`;

test("versions only the curated Unreleased section", () => {
  const result = finalizeChangelog(source, "0.2.0-alpha.0", "2026-07-16");
  assert.match(result, /## \[Unreleased\]\n\n_No changes recorded\._/);
  assert.match(result, /## \[0\.2\.0-alpha\.0\] - 2026-07-16\n\n### Added/);
  assert.equal(finalizeChangelog(result, "0.2.0-alpha.0", "2026-07-16"), result);
  assert.equal(extractReleaseNotes(result, "0.2.0-alpha.0"), "### Added\n\n- A reviewed product change.\n");
});

test("replaces a stale generated section ahead of the curated notes", () => {
  const generated = source.replace(
    "## [Unreleased]",
    "## [0.2.0-alpha.0](https://example.test/compare) (2026-07-16)\n\n### Bug Fixes\n\n- internal commit noise\n\n## [Unreleased]"
  );
  const result = finalizeChangelog(generated, "0.2.0-alpha.0", "2026-07-16");
  assert.doesNotMatch(result, /internal commit noise|example\.test/);
  assert.equal(extractReleaseNotes(result, "0.2.0-alpha.0"), "### Added\n\n- A reviewed product change.\n");
});

test("rejects an empty or ambiguous release-note source", () => {
  assert.throws(
    () => finalizeChangelog(source.replace("### Added\n\n- A reviewed product change.", ""), "0.2.0", "2026-07-16"),
    /reviewed release notes/
  );
  assert.throws(() => finalizeChangelog(`${source}\n## [Unreleased]\n`, "0.2.0", "2026-07-16"), /exactly one/);
});
