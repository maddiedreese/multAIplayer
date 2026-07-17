import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGitHubBranchName, normalizeGitHubRepoRef } from "../src/lib/git/githubValidation";

test("normalizeGitHubRepoRef trims valid owner and repo names", () => {
  assert.deepEqual(normalizeGitHubRepoRef(" maddiedreese ", " multAIplayer "), {
    owner: "maddiedreese",
    repo: "multAIplayer"
  });
  assert.deepEqual(normalizeGitHubRepoRef("open-ai-labs", "repo.name_1"), {
    owner: "open-ai-labs",
    repo: "repo.name_1"
  });
});

test("normalizeGitHubRepoRef rejects invalid owner and repo names", () => {
  for (const owner of ["", "-bad", "bad-", "bad/name", "bad name", "a".repeat(40)]) {
    assert.throws(() => normalizeGitHubRepoRef(owner, "repo"), /GitHub owner/);
  }
  for (const repo of ["", ".", "..", "bad/name", "bad repo", "a".repeat(101)]) {
    assert.throws(() => normalizeGitHubRepoRef("owner", repo), /GitHub repo/);
  }
});

test("normalizeGitHubBranchName accepts safe names and rejects unsafe ones", () => {
  assert.equal(normalizeGitHubBranchName(" codex/ship-it "), "codex/ship-it");
  for (const branch of [
    "",
    "-bad",
    "@",
    "bad branch",
    "bad\nbranch",
    "bad..branch",
    "bad~branch",
    "bad^branch",
    "bad:branch",
    "bad?branch",
    "bad*branch",
    "bad[branch",
    "bad\\branch",
    "bad//branch",
    ".bad/branch",
    "bad/.branch",
    "bad/branch.lock",
    "bad/",
    "bad.",
    "bad@{branch"
  ]) {
    assert.throws(() => normalizeGitHubBranchName(branch), /GitHub branch is required|Unsafe GitHub branch name/);
  }
  assert.throws(() => normalizeGitHubBranchName(`codex/${"x".repeat(200)}`), /Unsafe GitHub branch name/);
});
