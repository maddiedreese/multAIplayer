import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCoalescedAsyncTask, shouldRefreshCodexHostSnapshot } from "../src/lib/localBackend/codexHostBackend";

const repoRoot = new URL("../../..", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, repoRoot), "utf8");
}

test("Codex account controls stay in a host-local backend and out of relay/history paths", async () => {
  const [native, projection, backend, panel] = await Promise.all([
    source("apps/desktop/src-tauri/src/codex_account.rs"),
    source("apps/desktop/src-tauri/src/codex_request_projection.rs"),
    source("apps/desktop/src/lib/localBackend/codexHostBackend.ts"),
    source("apps/desktop/src/components/CodexAccountPanel.tsx")
  ]);

  assert.match(native, /stderr\(Stdio::null\(\)\)/);
  assert.match(projection, /account\/chatgptAuthTokens\/refresh/);
  assert.match(native, /Unsupported in host-control session/);
  assert.match(native, /sanitize_notification/);
  assert.doesNotMatch(backend, /relay|appendRoom|localStorage|sessionStorage|diagnostic/i);
  assert.doesNotMatch(panel, /relay|appendRoom|localStorage|sessionStorage|diagnostic/i);
  assert.match(panel, /Credentials remain in Codex on this device/);
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

test("host notifications refresh local account state without entering the app store", async () => {
  const panel = await source("apps/desktop/src/components/CodexAccountPanel.tsx");
  assert.match(panel, /listenForCodexHostNotifications/);
  assert.match(panel, /account\/login\/completed/);
  assert.match(panel, /mcpServer\/oauthLogin\/completed/);
  assert.doesNotMatch(panel, /useAppStore|publishRoom|roomId/);
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
