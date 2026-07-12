import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyJsonRpcMessage,
  createInitializeRequest,
  createThreadStartRequest,
  createTurnStartRequest
} from "../src/index";

test("initialize request identifies multAIplayer to codex app-server", () => {
  assert.deepEqual(createInitializeRequest(7), {
    method: "initialize",
    id: 7,
    params: {
      clientInfo: {
        name: "multaiplayer",
        title: "multAIplayer",
        version: "0.1.0-alpha.0"
      },
      capabilities: {
        experimentalApi: true
      }
    }
  });
});

test("thread and turn request builders preserve optional context", () => {
  assert.deepEqual(createThreadStartRequest("thread-request"), {
    method: "thread/start",
    id: "thread-request",
    params: { model: "gpt-5.6-sol" }
  });
  assert.deepEqual(createThreadStartRequest(2, "gpt-custom"), {
    method: "thread/start",
    id: 2,
    params: { model: "gpt-custom" }
  });
  assert.deepEqual(createTurnStartRequest(3, "thread-1", "hello"), {
    method: "turn/start",
    id: 3,
    params: { threadId: "thread-1", input: [{ type: "text", text: "hello" }] }
  });
  assert.equal((createTurnStartRequest(4, "thread-1", "hello", "/repo").params as { cwd: string }).cwd, "/repo");
});

test("classifies server requests before colliding responses", () => {
  assert.equal(
    classifyJsonRpcMessage({
      id: 2,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1" }
    }).kind,
    "serverRequest"
  );
  assert.equal(classifyJsonRpcMessage({ id: 2, result: { ok: true } }).kind, "response");
});

test("accepts string request ids and notifications", () => {
  assert.equal(
    classifyJsonRpcMessage({
      id: "server-1",
      method: "mcpServer/elicitation/request",
      params: {}
    }).kind,
    "serverRequest"
  );
  assert.equal(
    classifyJsonRpcMessage({
      method: "turn/completed",
      params: { turn: { status: "completed" } }
    }).kind,
    "notification"
  );
});

test("rejects malformed and ambiguous app-server envelopes", () => {
  assert.throws(() => classifyJsonRpcMessage(null), /JSON object/);
  assert.throws(() => classifyJsonRpcMessage([]), /JSON object/);
  assert.throws(() => classifyJsonRpcMessage("message"), /JSON object/);
  assert.throws(() => classifyJsonRpcMessage({ id: 1 }), /not a valid/);
  assert.throws(() => classifyJsonRpcMessage({ id: 1, result: {}, error: {} }), /not a valid/);
  assert.throws(() => classifyJsonRpcMessage({ method: "turn/completed", id: null }), /not a valid/);
  assert.throws(() => classifyJsonRpcMessage({ id: Number.MAX_SAFE_INTEGER + 1, result: {} }), /not a valid/);
});
