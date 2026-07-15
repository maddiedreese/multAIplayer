import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultGitWorkflowDraft,
  gitWorkflowInFlightMessage,
  isGitWorkflowInFlight,
  parseGitHubRemoteUrl,
  resolveGitWorkflowDraft,
  updateGitWorkflowDraftRecord
} from "../src/lib/git/gitWorkflowDraft";

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

test("git workflow in-flight guard is scoped to one room", () => {
  assert.equal(isGitWorkflowInFlight({ "room-a": true }, "room-a"), true);
  assert.equal(isGitWorkflowInFlight({ "room-a": true }, "room-b"), false);
  assert.equal(isGitWorkflowInFlight({ "room-a": false }, "room-a"), false);
  assert.equal(gitWorkflowInFlightMessage(), "A git workflow is already running in this room.");
});

test("parseGitHubRemoteUrl accepts GitHub ssh and https remotes", () => {
  assert.deepEqual(parseGitHubRemoteUrl("git@github.com:maddiedreese/multAIplayer.git"), {
    owner: "maddiedreese",
    repo: "multAIplayer"
  });
  assert.deepEqual(parseGitHubRemoteUrl("https://github.com/openai/codex"), {
    owner: "openai",
    repo: "codex"
  });
  assert.deepEqual(parseGitHubRemoteUrl("ssh://git@github.com/maddiedreese/multAIplayer.git"), {
    owner: "maddiedreese",
    repo: "multAIplayer"
  });
  assert.deepEqual(parseGitHubRemoteUrl("https://github.com/maddiedreese/multAIplayer/"), {
    owner: "maddiedreese",
    repo: "multAIplayer"
  });
});

test("parseGitHubRemoteUrl rejects non-GitHub and malformed remotes", () => {
  assert.equal(parseGitHubRemoteUrl("git@example.com:maddiedreese/multAIplayer.git"), null);
  assert.equal(parseGitHubRemoteUrl("https://github.com/maddiedreese/multAIplayer/issues"), null);
  assert.equal(parseGitHubRemoteUrl("https://github.com/bad owner/repo"), null);
  assert.equal(parseGitHubRemoteUrl(""), null);
});
