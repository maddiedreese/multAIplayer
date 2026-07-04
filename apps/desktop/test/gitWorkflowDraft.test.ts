import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultGitWorkflowDraft,
  resolveGitWorkflowDraft,
  updateGitWorkflowDraftRecord
} from "../src/lib/gitWorkflowDraft";

test("resolveGitWorkflowDraft returns defaults for a room without a draft", () => {
  assert.deepEqual(resolveGitWorkflowDraft({}, "room-a"), defaultGitWorkflowDraft);
});

test("updateGitWorkflowDraftRecord scopes draft updates to one room", () => {
  const drafts = updateGitWorkflowDraftRecord({}, "room-a", {
    branchName: "multaiplayer/room-a",
    prRepo: "alpha"
  });
  const updated = updateGitWorkflowDraftRecord(drafts, "room-b", {
    branchName: "multaiplayer/room-b"
  });

  assert.equal(resolveGitWorkflowDraft(updated, "room-a").branchName, "multaiplayer/room-a");
  assert.equal(resolveGitWorkflowDraft(updated, "room-a").prRepo, "alpha");
  assert.equal(resolveGitWorkflowDraft(updated, "room-b").branchName, "multaiplayer/room-b");
  assert.equal(resolveGitWorkflowDraft(updated, "room-b").prRepo, defaultGitWorkflowDraft.prRepo);
});

test("updateGitWorkflowDraftRecord preserves existing room fields on partial updates", () => {
  const drafts = updateGitWorkflowDraftRecord({}, "room-a", {
    branchName: "multaiplayer/room-a",
    pushEnabled: true
  });
  const updated = updateGitWorkflowDraftRecord(drafts, "room-a", {
    commitMessage: "Ship room scoped workflow"
  });

  assert.deepEqual(resolveGitWorkflowDraft(updated, "room-a"), {
    ...defaultGitWorkflowDraft,
    branchName: "multaiplayer/room-a",
    commitMessage: "Ship room scoped workflow",
    pushEnabled: true
  });
});
