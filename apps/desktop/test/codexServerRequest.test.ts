import assert from "node:assert/strict";
import test from "node:test";
import { describeCodexServerRequest } from "../src/components/CodexServerRequestDialog";

test("Codex server request display produces schema-specific approval decisions", () => {
  const current = describeCodexServerRequest({
    requestKey: "rpc-1",
    roomId: "room-1",
    expiresAtMs: Date.now() + 60_000,
    proposedBy: null,
    contextSummary: null,
    method: "item/commandExecution/requestApproval",
    params: { command: ["npm", "test"], cwd: "/workspace" }
  });
  assert.deepEqual(current.accept({}), { result: { decision: "accept" } });
  assert.deepEqual(current.decline, { result: { decision: "decline" } });
  assert.doesNotMatch(current.detail ?? "", /undefined/);
  assert.match(current.warning ?? "", /checks are incomplete/);

  const legacy = describeCodexServerRequest({
    requestKey: "rpc-2",
    roomId: "room-1",
    expiresAtMs: Date.now() + 60_000,
    proposedBy: null,
    contextSummary: null,
    method: "execCommandApproval",
    params: {}
  });
  assert.deepEqual(legacy.accept({}), { result: { decision: "approved" } });
  assert.deepEqual(legacy.decline, { result: { decision: "denied" } });
});

test("Codex command approval never claims interpreter text is safe", () => {
  const display = describeCodexServerRequest({
    requestKey: "rpc-interpreter",
    roomId: "room-1",
    expiresAtMs: Date.now() + 60_000,
    proposedBy: null,
    contextSummary: null,
    method: "item/commandExecution/requestApproval",
    params: { command: ["python", "-c", "import socket"] }
  });

  assert.match(display.warning ?? "", /cannot rule out interpreter, script, indirect network, or credential access/);
});

test("Codex user input stays local and maps only bounded question ids", () => {
  const display = describeCodexServerRequest({
    requestKey: "rpc-3",
    roomId: "room-1",
    expiresAtMs: Date.now() + 60_000,
    proposedBy: null,
    contextSummary: null,
    method: "item/tool/requestUserInput",
    params: {
      questions: [
        { id: "choice", question: "Which option?" },
        { id: "secret", question: "Token", isSecret: true },
        { id: "third", question: "Third" },
        { id: "ignored", question: "Fourth" }
      ]
    }
  });
  assert.equal(display.questions.length, 3);
  assert.equal(display.questions.at(1)?.secret, true);
  assert.equal(display.canAccept({ choice: "A", secret: "private", third: "C" }), true);
  assert.deepEqual(display.accept({ choice: "A", secret: "private", third: "C" }), {
    result: {
      answers: {
        choice: { answers: ["A"] },
        secret: { answers: ["private"] },
        third: { answers: ["C"] }
      }
    }
  });
});

test("Codex permission acceptance returns only the requested profile", () => {
  const permissions = { network: { enabled: true } };
  const display = describeCodexServerRequest({
    requestKey: "rpc-4",
    roomId: "room-1",
    expiresAtMs: Date.now() + 60_000,
    proposedBy: null,
    contextSummary: null,
    method: "item/permissions/requestApproval",
    params: { permissions }
  });
  assert.deepEqual(display.accept({}), { result: { permissions, scope: "turn" } });
  assert.deepEqual(display.decline, { result: { permissions: {}, scope: "turn" } });
});

test("MCP URL elicitations expose only a safe clickable web URL", () => {
  const display = describeCodexServerRequest({
    requestKey: "rpc-url",
    roomId: "room-1",
    expiresAtMs: Date.now() + 60_000,
    proposedBy: null,
    contextSummary: null,
    method: "mcpServer/elicitation/request",
    params: { mode: "url", message: "Sign in", url: "https://example.com/oauth" }
  });
  assert.equal(display.url, "https://example.com/oauth");
  assert.equal(display.canAccept({}), true);
  assert.deepEqual(display.accept({}), { result: { action: "accept", content: null } });
});

test("MCP form elicitations render typed bounded fields and structured content", () => {
  const display = describeCodexServerRequest({
    requestKey: "rpc-form",
    roomId: "room-1",
    expiresAtMs: Date.now() + 60_000,
    proposedBy: null,
    contextSummary: null,
    method: "mcpServer/elicitation/request",
    params: {
      mode: "form",
      message: "Configure integration",
      requestedSchema: {
        type: "object",
        required: ["region", "retries", "enabled"],
        properties: {
          region: { type: "string", title: "Region", enum: ["us", "eu"] },
          retries: { type: "integer", minimum: 1, maximum: 3 },
          enabled: { type: "boolean" },
          scopes: {
            type: "array",
            items: { type: "string", enum: ["read", "write"] },
            maxItems: 2
          }
        }
      }
    }
  });
  assert.deepEqual(
    display.questions.map((question) => question.kind),
    ["select", "number", "boolean", "multiselect"]
  );
  assert.equal(display.canAccept({ region: "us", retries: "2", enabled: true, scopes: ["read"] }), true);
  assert.equal(display.canAccept({ region: "apac", retries: "4", enabled: true }), false);
  assert.deepEqual(display.accept({ region: "eu", retries: "3", enabled: false, scopes: ["read", "write"] }), {
    result: {
      action: "accept",
      content: { region: "eu", retries: 3, enabled: false, scopes: ["read", "write"] }
    }
  });
});
