import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyJsonRpcMessage, createInitializeRequest } from "../src/index";

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
  assert.throws(() => classifyJsonRpcMessage({ id: 1 }), /not a valid/);
  assert.throws(() => classifyJsonRpcMessage({ id: 1, result: {}, error: {} }), /not a valid/);
  assert.throws(() => classifyJsonRpcMessage({ method: "turn/completed", id: null }), /not a valid/);
});
