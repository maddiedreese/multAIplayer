import assert from "node:assert/strict";
import test from "node:test";
import type { GitHubAuthConfig, SignedInUser } from "../src/lib/identity/authClient";
import { minimumSupportedCodexVersion } from "../src/lib/codex/codexCompatibility";
import type { CodexProbe } from "../src/lib/platform/localBackend";
import {
  projectOnboardingReadiness,
  type OnboardingReadinessInput,
  type OnboardingReadinessRow
} from "../src/application/onboarding/onboardingReadiness";

const githubConfig: GitHubAuthConfig = {
  provider: "github",
  configured: true,
  scopes: ["read:user"],
  mutationsRequireAuth: false,
  allowedOrigins: [],
  sessionPersistence: "identity_only"
};

const githubUser: SignedInUser = { id: "user_1", login: "person" };

function probe(version = minimumSupportedCodexVersion): CodexProbe {
  return { available: true, version, error: null, models: [], modelError: null };
}

function readyInput(overrides: Partial<OnboardingReadinessInput> = {}): OnboardingReadinessInput {
  return {
    intent: "create",
    workspace: { status: "ready", error: null },
    github: {
      configResolved: true,
      userResolved: true,
      config: githubConfig,
      user: githubUser,
      busy: false,
      error: null
    },
    codexProbe: probe(),
    codexAccount: { status: "ready", ready: true, message: "ChatGPT account connected." },
    projectFolderSelected: true,
    ...overrides
  };
}

function byId(rows: OnboardingReadinessRow[], id: OnboardingReadinessRow["id"]): OnboardingReadinessRow {
  return rows.find((candidate) => candidate.id === id)!;
}

test("readiness rows stay ordered and fully ready inputs do not block", () => {
  const rows = projectOnboardingReadiness(readyInput());
  assert.deepEqual(
    rows.map(({ id }) => id),
    ["relay", "github", "codex", "chatgpt", "project"]
  );
  assert.equal(rows.length, 5);
  assert.ok(
    rows.every(({ status, blocking, warning, action }) => status === "ready" && !blocking && !warning && !action)
  );
});

test("GitHub is optional for local create but required for invite join", () => {
  const signedOut = { ...readyInput().github, user: null };
  const create = byId(projectOnboardingReadiness(readyInput({ github: signedOut })), "github");
  assert.equal(create.status, "warning");
  assert.equal(create.blocking, false);
  assert.equal(create.action, "sign_in_github");

  const join = byId(projectOnboardingReadiness(readyInput({ intent: "join", github: signedOut })), "github");
  assert.equal(join.status, "blocked");
  assert.equal(join.blocking, true);
  assert.equal(join.action, "sign_in_github");
});

test("create follows relay mutation authentication policy and unresolved auth remains checking", () => {
  const required = byId(
    projectOnboardingReadiness(
      readyInput({
        github: { ...readyInput().github, config: { ...githubConfig, mutationsRequireAuth: true }, user: null }
      })
    ),
    "github"
  );
  assert.equal(required.status, "blocked");

  const checking = byId(
    projectOnboardingReadiness(
      readyInput({ github: { ...readyInput().github, configResolved: false, userResolved: false, user: null } })
    ),
    "github"
  );
  assert.equal(checking.status, "checking");
  assert.equal(checking.action, null);
});

test("unconfigured GitHub blocks join and only warns for create", () => {
  const github = { ...readyInput().github, config: { ...githubConfig, configured: false }, user: null };
  assert.equal(byId(projectOnboardingReadiness(readyInput({ github })), "github").status, "warning");
  const join = byId(projectOnboardingReadiness(readyInput({ intent: "join", github })), "github");
  assert.equal(join.status, "blocked");
  assert.equal(join.action, null);
});

test("failed GitHub policy discovery is explicit, fail closed, and directly retryable", () => {
  const github = {
    ...readyInput().github,
    config: null,
    user: null,
    error: "relay token=must-not-render"
  };
  const row = byId(projectOnboardingReadiness(readyInput({ github })), "github");
  assert.equal(row.status, "blocked");
  assert.equal(row.blocking, true);
  assert.equal(row.action, "retry_workspace_bootstrap");
  assert.doesNotMatch(row.text, /token|must-not-render/i);
});

test("workspace failure and unresolved relay state both block progress", () => {
  const loading = byId(
    projectOnboardingReadiness(readyInput({ workspace: { status: "loading", error: null } })),
    "relay"
  );
  assert.equal(loading.status, "checking");
  assert.equal(loading.blocking, true);

  const failed = byId(
    projectOnboardingReadiness(readyInput({ workspace: { status: "error", error: "secret=do-not-render" } })),
    "relay"
  );
  assert.equal(failed.status, "blocked");
  assert.equal(failed.action, "retry_workspace_bootstrap");
  assert.doesNotMatch(failed.text, /secret|do-not-render/i);
});

test("Codex availability and old versions block while newer and unknown versions warn", () => {
  const unavailable = byId(
    projectOnboardingReadiness(
      readyInput({ codexProbe: { ...probe(), available: false, error: "/private/project/token" } })
    ),
    "codex"
  );
  assert.equal(unavailable.status, "blocked");
  assert.equal(unavailable.action, "refresh_codex");
  assert.doesNotMatch(unavailable.text, /private|project|token/i);

  const old = byId(projectOnboardingReadiness(readyInput({ codexProbe: probe("0.1.0") })), "codex");
  assert.equal(old.status, "blocked");
  assert.equal(old.action, "update_codex");

  const newer = byId(projectOnboardingReadiness(readyInput({ codexProbe: probe("999.0.0") })), "codex");
  assert.equal(newer.status, "warning");
  assert.equal(newer.blocking, false);

  const unknown = byId(projectOnboardingReadiness(readyInput({ codexProbe: probe("development") })), "codex");
  assert.equal(unknown.status, "warning");
  assert.equal(unknown.blocking, false);
});

test("ChatGPT readiness maps to fixed repair actions without forwarding arbitrary errors", () => {
  const ready = byId(
    projectOnboardingReadiness(
      readyInput({ codexAccount: { status: "ready", ready: true, message: "code=must-not-render" } })
    ),
    "chatgpt"
  );
  assert.equal(ready.status, "ready");
  assert.doesNotMatch(ready.text, /must-not-render/);

  const signIn = byId(
    projectOnboardingReadiness(
      readyInput({
        codexAccount: {
          status: "sign_in_required",
          ready: false,
          message: "Sign in with ChatGPT to authorize Codex on this device."
        }
      })
    ),
    "chatgpt"
  );
  assert.equal(signIn.status, "blocked");
  assert.equal(signIn.action, "sign_in_chatgpt");

  const unavailable = byId(
    projectOnboardingReadiness(
      readyInput({ codexAccount: { status: "unavailable", ready: false, message: "code=secret-value" } })
    ),
    "chatgpt"
  );
  assert.equal(unavailable.action, "refresh_codex");
  assert.doesNotMatch(unavailable.text, /secret-value/);
});

test("project folder selection is explicitly deferrable and never returns a path", () => {
  const project = byId(projectOnboardingReadiness(readyInput({ projectFolderSelected: false })), "project");
  assert.equal(project.status, "warning");
  assert.equal(project.blocking, false);
  assert.equal(project.action, "select_project_folder");
  assert.doesNotMatch(JSON.stringify(project), /\/Users\/person|\/tmp\/secret/);
});

test("invite join blocks only on relay and GitHub identity readiness", () => {
  const rows = projectOnboardingReadiness(
    readyInput({
      intent: "join",
      codexProbe: null,
      codexAccount: { status: "checking", ready: false, message: "Checking" },
      projectFolderSelected: false
    })
  );
  assert.equal(byId(rows, "relay").blocking, false);
  assert.equal(byId(rows, "github").blocking, false);
  assert.equal(byId(rows, "codex").status, "checking");
  assert.equal(byId(rows, "codex").blocking, false);
  assert.equal(byId(rows, "chatgpt").status, "checking");
  assert.equal(byId(rows, "chatgpt").blocking, false);
  assert.equal(byId(rows, "project").blocking, false);
  assert.equal(byId(rows, "project").action, null);
});

test("creator readiness keeps local Codex and required ChatGPT authorization blocking", () => {
  const rows = projectOnboardingReadiness(
    readyInput({
      intent: "create",
      codexProbe: null,
      codexAccount: { status: "checking", ready: false, message: "Checking" }
    })
  );
  assert.equal(byId(rows, "codex").blocking, true);
  assert.equal(byId(rows, "chatgpt").blocking, true);
});
