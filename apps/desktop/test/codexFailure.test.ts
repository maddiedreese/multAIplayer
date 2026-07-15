import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCodexFailure, codexUsageLimitMessage } from "../src/lib/codex/codexFailure";

test("classifyCodexFailure detects usage limit and quota failures", () => {
  assert.equal(classifyCodexFailure(["Error: usage limit reached"]), "usage_limit");
  assert.equal(classifyCodexFailure(["turn/start failed", "429 Too Many Requests"]), "usage_limit");
  assert.equal(classifyCodexFailure(["insufficient quota, try again later"]), "usage_limit");
});

test("classifyCodexFailure distinguishes auth and app-server failures", () => {
  assert.equal(classifyCodexFailure(["401 unauthorized"]), "auth");
  assert.equal(classifyCodexFailure(["Failed to start codex app-server"]), "app_server_unavailable");
  assert.equal(classifyCodexFailure(["unexpected model error"]), "unknown");
});

test("codexUsageLimitMessage invites another host to continue", () => {
  assert.equal(
    codexUsageLimitMessage("Maddie"),
    "Maddie is out of Codex usage. Another host can continue with the full room context."
  );
});
