import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGitHubBranchName, normalizeGitHubRepoRef, normalizePullRequestDraft } from "../src/index";

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

test("normalizePullRequestDraft normalizes repo, title, head, and base", () => {
  assert.deepEqual(
    normalizePullRequestDraft({
      owner: " maddiedreese ",
      repo: " multAIplayer ",
      title: "  Ship workflow  ",
      body: "body stays as written",
      head: " codex/workflow ",
      base: " main ",
      draft: true
    }),
    {
      owner: "maddiedreese",
      repo: "multAIplayer",
      title: "Ship workflow",
      body: "body stays as written",
      head: "codex/workflow",
      base: "main",
      draft: true
    }
  );
});

test("normalizePullRequestDraft rejects empty titles", () => {
  assert.throws(
    () =>
      normalizePullRequestDraft({
        owner: "maddiedreese",
        repo: "multAIplayer",
        title: " ",
        body: "",
        head: "codex/workflow",
        base: "main",
        draft: true
      }),
    /Pull request title is required/
  );
});

test("normalizePullRequestDraft defaults and validates base branch", () => {
  assert.equal(
    normalizePullRequestDraft({
      owner: "maddiedreese",
      repo: "multAIplayer",
      title: "Ship workflow",
      body: "",
      head: "codex/workflow",
      base: "",
      draft: true
    }).base,
    "main"
  );

  assert.throws(
    () =>
      normalizePullRequestDraft({
        owner: "maddiedreese",
        repo: "multAIplayer",
        title: "Ship workflow",
        body: "",
        head: "codex/workflow",
        base: "bad base",
        draft: true
      }),
    /Unsafe GitHub branch name/
  );
});
