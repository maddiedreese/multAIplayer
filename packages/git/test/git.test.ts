import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeBranchName,
  createBranchApproval,
  createGitWorkflowApprovalPlan,
  formatGitWorkflowApprovalPreview,
  maxCommitMessageChars,
  maxGitBranchNameChars,
  normalizeCommitMessage
} from "../src/index";

test("createGitWorkflowApprovalPlan creates local-only branch and commit approvals", () => {
  const plan = createGitWorkflowApprovalPlan("/repo", "feature/room-chat", "  Add room chat   polish  ", false);

  assert.equal(plan.branch, "feature/room-chat");
  assert.equal(plan.message, "Add room chat polish");
  assert.equal(plan.push, false);
  assert.deepEqual(
    plan.approvals.map((approval) => approval.action),
    ["branch", "commit"]
  );
  assert.deepEqual(
    plan.approvals.flatMap((approval) => approval.commands),
    ["git switch -c 'feature/room-chat'", "git add -A", "git commit -m 'Add room chat polish'"]
  );
});

test("createGitWorkflowApprovalPlan includes push and draft PR approval steps", () => {
  const plan = createGitWorkflowApprovalPlan("/repo", "codex/test-plan", "Commit changes", true);

  assert.deepEqual(
    plan.approvals.map((approval) => approval.action),
    ["branch", "commit", "push", "pull_request"]
  );
  assert.deepEqual(
    plan.approvals.flatMap((approval) => approval.commands),
    [
      "git switch -c 'codex/test-plan'",
      "git add -A",
      "git commit -m 'Commit changes'",
      "git push -u origin 'codex/test-plan'",
      "gh pr create --draft --head 'codex/test-plan'"
    ]
  );
});

test("formatGitWorkflowApprovalPreview exposes pre-run host review steps", () => {
  const plan = createGitWorkflowApprovalPlan("/repo", "codex/test-plan", "Commit changes", true);
  const preview = formatGitWorkflowApprovalPreview(plan);

  assert.deepEqual(
    preview.map((item) => item.title),
    [
      "Create branch codex/test-plan",
      "Commit staged room changes",
      "Push branch codex/test-plan",
      "Open draft pull request from codex/test-plan"
    ]
  );
  assert.deepEqual(
    preview.flatMap((item) => item.commands),
    [
      "git switch -c 'codex/test-plan'",
      "git add -A",
      "git commit -m 'Commit changes'",
      "git push -u origin 'codex/test-plan'",
      "gh pr create --draft --head 'codex/test-plan'"
    ]
  );
  assert.match(preview.at(-1)?.detail ?? "", /signed-in GitHub session/);
});

test("approval command previews quote single quotes safely", () => {
  const approval = createBranchApproval("/repo", "codex/maddie-test");
  assert.deepEqual(approval.commands, ["git switch -c 'codex/maddie-test'"]);

  const plan = createGitWorkflowApprovalPlan("/repo", "codex/maddie-test", "Maddie's commit", false);
  assert.ok(plan.approvals.flatMap((item) => item.commands).includes("git commit -m 'Maddie'\\''s commit'"));
});

test("assertSafeBranchName rejects branch names that should not reach git commands", () => {
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
    assert.throws(() => assertSafeBranchName(branch), /Branch name is required|Unsafe branch name/);
  }
  assert.throws(() => assertSafeBranchName(`codex/${"x".repeat(maxGitBranchNameChars)}`), /Unsafe branch name/);
});

test("normalizeCommitMessage trims, bounds, and rejects empty messages", () => {
  assert.equal(normalizeCommitMessage("  Ship   the thing  "), "Ship the thing");
  assert.throws(() => normalizeCommitMessage(" \n\t "), /Commit message is required/);
  assert.throws(() => normalizeCommitMessage("x".repeat(maxCommitMessageChars + 1)), /Commit message must be/);
});
