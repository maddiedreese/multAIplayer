import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCoalescedAsyncTask, shouldRefreshCodexHostSnapshot } from "../src/lib/localBackend/codexHostBackend";
import { projectCodexAccountReadiness } from "../src/hooks/useCodexAccount";
import type { CodexHostSnapshot } from "../src/lib/localBackend";

const repoRoot = new URL("../../..", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, repoRoot), "utf8");
}

test("Codex account controls stay in a host-local backend and out of relay/history paths", async () => {
  const [native, projection, backend, panel, controller] = await Promise.all([
    source("apps/desktop/src-tauri/src/codex_account.rs"),
    source("apps/desktop/src-tauri/src/codex_request_projection.rs"),
    source("apps/desktop/src/lib/localBackend/codexHostBackend.ts"),
    source("apps/desktop/src/components/CodexAccountPanel.tsx"),
    source("apps/desktop/src/hooks/useCodexAccount.tsx")
  ]);

  assert.match(native, /stderr\(Stdio::null\(\)\)/);
  assert.match(projection, /account\/chatgptAuthTokens\/refresh/);
  assert.match(native, /Unsupported in host-control session/);
  assert.match(native, /sanitize_notification/);
  assert.doesNotMatch(backend, /relay|appendRoom|localStorage|sessionStorage|diagnostic/i);
  assert.doesNotMatch(panel, /relay|appendRoom|localStorage|sessionStorage|diagnostic/i);
  assert.doesNotMatch(controller, /relay|appendRoom|localStorage|sessionStorage|diagnostic/i);
  assert.match(controller, /Credentials remain in Codex on this device/);
});

test("Codex host UI exposes browser and device login, MCP status, and gated writes approval", async () => {
  const [panel, currentManifest, previousManifest] = await Promise.all([
    source("apps/desktop/src/components/CodexAccountPanel.tsx"),
    source("contracts/codex-app-server/0.144.0.json").then(JSON.parse),
    source("contracts/codex-app-server/0.143.0.json").then(JSON.parse)
  ]);

  assert.match(panel, /Sign in with ChatGPT/);
  assert.match(panel, /Use device code/);
  assert.match(panel, /MCP servers/);
  assert.match(panel, /supportsWritesApproval/);
  assert.match(panel, /Prompt for writes/);
  assert.ok(currentManifest.appToolApprovalModes.includes("writes"));
  assert.ok(!previousManifest.appToolApprovalModes.includes("writes"));
});

test("host notifications refresh the shared local account controller without entering the app store", async () => {
  const [panel, controller, app] = await Promise.all([
    source("apps/desktop/src/components/CodexAccountPanel.tsx"),
    source("apps/desktop/src/hooks/useCodexAccount.tsx"),
    source("apps/desktop/src/App.tsx")
  ]);
  assert.match(controller, /listenForCodexHostNotifications/);
  assert.match(controller, /account\/login\/completed/);
  assert.match(controller, /mcpServer\/oauthLogin\/completed/);
  assert.doesNotMatch(controller, /useAppStore|publishRoom|roomId/);
  assert.match(panel, /useCodexAccount\(\)/);
  assert.match(app, /<CodexAccountProvider>/);
  assert.equal(app.match(/<CodexAccountProvider>/g)?.length, 1);
});

test("Codex host refreshes coalesce bursts and never overlap", async () => {
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const releases: Array<() => void> = [];
  const task = createCoalescedAsyncTask(async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
  }, 0);

  const first = task.request();
  const coalesced = task.request();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 1);
  const queued = task.request();
  releases.shift()?.();
  await Promise.all([first, coalesced]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
  releases.shift()?.();
  await queued;
  task.cancelPending();
});

test("inventory notifications cannot create a list-refresh feedback loop", () => {
  assert.equal(shouldRefreshCodexHostSnapshot("app/list/updated", 20), false);
  assert.equal(shouldRefreshCodexHostSnapshot("mcpServer/startupStatus/updated", 20), false);
  assert.equal(shouldRefreshCodexHostSnapshot("app/list/updated", 1_001), true);
  assert.equal(shouldRefreshCodexHostSnapshot("account/login/completed", 0), true);
  assert.equal(shouldRefreshCodexHostSnapshot("mcpServer/oauthLogin/completed", 0), true);
});

const hostSnapshot = (overrides: Partial<CodexHostSnapshot> = {}): CodexHostSnapshot => ({
  capabilities: {
    codexVersion: "0.144.0",
    manifestVersion: "0.144.0",
    supportsAccount: true,
    supportsBrowserLogin: true,
    supportsDeviceLogin: true,
    supportsHostedLoginSuccess: true,
    supportsApps: true,
    supportsMcp: true,
    supportsWritesApproval: true,
    compatibilityWarning: null
  },
  requiresOpenaiAuth: true,
  account: null,
  apps: [],
  appsError: null,
  mcpServers: [],
  mcpError: null,
  ...overrides
});

test("Codex account readiness distinguishes loading, unavailable, sign-in, and ready states", () => {
  assert.deepEqual(projectCodexAccountReadiness({ native: true, snapshot: null, busy: true, error: null }), {
    status: "checking",
    ready: false,
    message: "Checking Codex and ChatGPT account status…"
  });
  assert.deepEqual(projectCodexAccountReadiness({ native: true, snapshot: null, busy: false, error: "offline" }), {
    status: "unavailable",
    ready: false,
    message: "offline"
  });
  assert.equal(
    projectCodexAccountReadiness({ native: true, snapshot: hostSnapshot(), busy: false, error: null }).status,
    "sign_in_required"
  );
  assert.deepEqual(
    projectCodexAccountReadiness({
      native: true,
      snapshot: hostSnapshot({
        account: { accountType: "chatgpt", email: "person@example.com", planType: "pro" }
      }),
      busy: false,
      error: null
    }),
    { status: "ready", ready: true, message: "ChatGPT account connected." }
  );
  assert.deepEqual(
    projectCodexAccountReadiness({
      native: true,
      snapshot: hostSnapshot({ requiresOpenaiAuth: false }),
      busy: false,
      error: null
    }),
    { status: "ready", ready: true, message: "Codex is ready without ChatGPT sign-in." }
  );
  assert.equal(
    projectCodexAccountReadiness({ native: false, snapshot: null, busy: false, error: null }).status,
    "native_required"
  );
});
