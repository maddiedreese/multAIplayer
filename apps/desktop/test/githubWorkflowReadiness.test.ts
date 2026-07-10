import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitHubAuthConfig, SignedInUser } from "../src/lib/authClient";
import {
  checkGitHubActionsReadiness,
  checkGitHubWorkflowReadiness,
  gitHubActionsRefreshInFlightMessage,
  isGitHubActionsRefreshInFlight
} from "../src/lib/githubWorkflowReadiness";

const authConfig: GitHubAuthConfig = {
  provider: "github",
  configured: true,
  scopes: ["read:user", "public_repo"],
  mutationsRequireAuth: true,
  allowedOrigins: ["http://127.0.0.1:1420"],
  sessionPersistence: "encrypted"
};

const user: SignedInUser = {
  id: "123",
  login: "maddiedreese"
};

test("checkGitHubWorkflowReadiness allows local-only git workflows without GitHub", () => {
  const readiness = checkGitHubWorkflowReadiness({
    pushEnabled: false,
    authConfig: null,
    currentUser: null,
    owner: "",
    repo: "",
    head: "codex/local-only",
    base: ""
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.target, null);
  assert.match(readiness.messages[0], /Local branch and commit only/);
});

test("checkGitHubWorkflowReadiness requires GitHub sign-in and valid repo target for PR workflows", () => {
  const readiness = checkGitHubWorkflowReadiness({
    pushEnabled: true,
    authConfig: { ...authConfig, configured: false, scopes: ["read:user"] },
    currentUser: null,
    owner: "bad owner",
    repo: "multAIplayer",
    head: "codex/ship",
    base: "main"
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.messages, [
    "GitHub sign-in is not configured on this relay.",
    "Sign in with GitHub before approving a push and draft PR.",
    "GitHub permissions need public_repo for public repos or repo for private repos.",
    "Error: GitHub owner must be a valid user or organization name."
  ]);
});

test("checkGitHubWorkflowReadiness returns normalized PR target when ready", () => {
  const readiness = checkGitHubWorkflowReadiness({
    pushEnabled: true,
    authConfig,
    currentUser: user,
    owner: " maddiedreese ",
    repo: " multAIplayer ",
    head: " codex/ship ",
    base: " main "
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.target, "maddiedreese/multAIplayer:codex/ship -> main");
  assert.equal(readiness.normalizedBase, "main");
  assert.deepEqual(readiness.messages, [
    "Ready to push and open a draft PR: maddiedreese/multAIplayer:codex/ship -> main."
  ]);
});

test("checkGitHubActionsReadiness requires sign-in and a valid repo target", () => {
  const readiness = checkGitHubActionsReadiness({
    authConfig: { ...authConfig, configured: false },
    currentUser: null,
    owner: "bad owner",
    repo: "multAIplayer",
    branch: "bad branch"
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.target, null);
  assert.equal(readiness.normalizedTarget, null);
  assert.deepEqual(readiness.messages, [
    "GitHub sign-in is not configured on this relay.",
    "Sign in with GitHub before checking Actions.",
    "Error: GitHub owner must be a valid user or organization name."
  ]);
});

test("GitHub Actions refresh in-flight guard is scoped to one room", () => {
  assert.equal(isGitHubActionsRefreshInFlight({ "room-a": true }, "room-a"), true);
  assert.equal(isGitHubActionsRefreshInFlight({ "room-a": true }, "room-b"), false);
  assert.equal(isGitHubActionsRefreshInFlight({ "room-a": false }, "room-a"), false);
  assert.equal(gitHubActionsRefreshInFlightMessage(), "GitHub Actions refresh is already running in this room.");
});

test("checkGitHubActionsReadiness rejects unsafe branch targets", () => {
  const readiness = checkGitHubActionsReadiness({
    authConfig,
    currentUser: user,
    owner: "maddiedreese",
    repo: "multAIplayer",
    branch: "bad branch"
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.target, null);
  assert.equal(readiness.normalizedTarget, null);
  assert.deepEqual(readiness.messages, ["Error: Unsafe GitHub branch name: bad branch"]);
});

test("checkGitHubActionsReadiness returns normalized Actions target when ready", () => {
  const readiness = checkGitHubActionsReadiness({
    authConfig,
    currentUser: user,
    owner: " maddiedreese ",
    repo: " multAIplayer ",
    branch: " codex/actions "
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.target, "maddiedreese/multAIplayer@codex/actions");
  assert.deepEqual(readiness.normalizedTarget, {
    owner: "maddiedreese",
    repo: "multAIplayer",
    branch: "codex/actions"
  });
  assert.deepEqual(readiness.messages, ["Ready to check GitHub Actions for maddiedreese/multAIplayer@codex/actions."]);
});
