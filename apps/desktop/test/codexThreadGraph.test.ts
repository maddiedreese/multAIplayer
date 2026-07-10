import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexThreadGraphView } from "../src/components/CodexThreadGraphPanel";
import { deriveCodexAgentTree, mergeCodexThreadGraph, normalizeCodexThreadGraph } from "../src/lib/codexThreadGraph";
import { useAppStore } from "../src/store/appStore";
import type { CodexActivity, CodexThreadGraph } from "../src/types";

test.beforeEach(() => useAppStore.getState().resetAppStore());

test("legacy active thread state migrates into a normalized durable graph", () => {
  const graph = normalizeCodexThreadGraph(undefined, "thread-legacy");
  assert.equal(graph.activeThreadId, "thread-legacy");
  assert.equal(graph.nodesById["thread-legacy"]?.title, "Codex thread");
});

test("thread graph merge adopts only the active session tree", () => {
  const graph = mergeCodexThreadGraph(normalizeCodexThreadGraph(undefined, "thread-root"), [
    node("thread-root", "session-a"),
    node("thread-child", "session-a", "thread-root"),
    node("unrelated", "session-b")
  ]);
  assert.deepEqual(Object.keys(graph.nodesById).sort(), ["thread-child", "thread-root"]);
});

test("thread graph discovery fails closed when the unresolved active thread is absent", () => {
  const graph = mergeCodexThreadGraph(normalizeCodexThreadGraph(undefined, "thread-root"), [
    node("unrelated-a", "session-a"),
    node("unrelated-b", "session-b")
  ]);
  assert.deepEqual(Object.keys(graph.nodesById), ["thread-root"]);
});

test("active-thread selection drives the legacy turn and goal projection", () => {
  const store = useAppStore.getState();
  store.setCodexThreadIdForRoom("room-a", "thread-root");
  store.mergeCodexThreadsForRoom("room-a", [
    node("thread-root", "session-a"),
    node("thread-child", "session-a", "thread-root")
  ]);
  store.setActiveCodexThreadForRoom("room-a", "thread-child");
  const runtime = useAppStore.getState().codexRuntimeByRoom["room-a"];
  assert.equal(runtime?.threadGraph?.activeThreadId, "thread-child");
});

test("an explicit fork is added as a child and becomes active without broad discovery", () => {
  const store = useAppStore.getState();
  store.setCodexThreadIdForRoom("room-a", "thread-root");
  store.addCodexForkForRoom("room-a", node("thread-child", "session-a", "thread-root"));
  const graph = useAppStore.getState().codexRuntimeByRoom["room-a"]?.threadGraph;
  assert.equal(graph?.activeThreadId, "thread-child");
  assert.equal(graph?.nodesById["thread-child"]?.parentThreadId, "thread-root");
});

test("agent tree is derived only from normalized subagent activities and remains distinct", () => {
  const activities: CodexActivity[] = [activity(), activity({
    activityId: "agent-spawn", itemId: "agent-spawn", kind: "agent",
    agent: { action: "spawn", senderId: "agent-root", receiverIds: ["agent-child"] }
  })];
  assert.deepEqual(deriveCodexAgentTree(activities).map(({ id, parentId }) => ({ id, parentId })), [
    { id: "agent-root", parentId: null },
    { id: "agent-child", parentId: "agent-root" }
  ]);
});

test("thread graph UI renders switch/fork controls and a separate agent tree", () => {
  const graph: CodexThreadGraph = {
    activeThreadId: "thread-root",
    nodesById: { "thread-root": node("thread-root", "session-a"), "thread-child": node("thread-child", "session-a", "thread-root") }
  };
  const html = renderToStaticMarkup(React.createElement(CodexThreadGraphView, {
    graph,
    agentTree: [{ id: "agent-child", parentId: "agent-root", status: "running", lastAction: "spawn", updatedAt: "2026-07-09T12:00:00.000Z" }],
    busy: false, message: null, lastTurnId: "", onLastTurnIdChange() {}, onRefresh() {}, onFork() {}, onSwitch() {}
  }));
  assert.match(html, /Thread graph/);
  assert.match(html, /Fork active/);
  assert.match(html, /Switch/);
  assert.match(html, /Agent tree/);
});

function node(id: string, sessionId: string, parentThreadId?: string) {
  return { id, sessionId, ...(parentThreadId ? { parentThreadId } : {}), title: id, status: "idle" as const, createdAt: 1, updatedAt: 1 };
}

function activity(overrides: Partial<CodexActivity> = {}): CodexActivity {
  return {
    eventType: "codex.activity", activityId: "command", turnId: "turn", itemId: "command",
    kind: "command", status: "running", title: "Command execution",
    startedAt: "2026-07-09T12:00:00.000Z", updatedAt: "2026-07-09T12:00:00.000Z",
    host: "Host", hostUserId: "user-host", ...overrides
  };
}
