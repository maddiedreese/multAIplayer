import React from "react";
import { Circle, CornerDownRight } from "lucide-react";
import { forkCodexThread, getCodexGoal, listCodexThreads } from "../lib/localBackend";
import { deriveCodexAgentTree } from "../lib/codexThreadGraph";
import { codexGoalToRoomGoal } from "../lib/roomGoals";
import { useAppStore } from "../store/appStore";
import type { CodexAgentTreeNode, CodexThreadGraph } from "../types";
import { reportNonFatal } from "../lib/nonFatalReporting";

export function CodexThreadGraphPanel({ roomId, projectPath }: { roomId: string; projectPath: string }) {
  const runtime = useAppStore((state) => state.codexRuntimeByRoom[roomId]);
  const mergeThreads = useAppStore((state) => state.mergeCodexThreadsForRoom);
  const setActiveThread = useAppStore((state) => state.setActiveCodexThreadForRoom);
  const addFork = useAppStore((state) => state.addCodexForkForRoom);
  const setRoomGoal = useAppStore((state) => state.setRoomGoalForRoom);
  const graph = runtime?.threadGraph;
  const agentTree = deriveCodexAgentTree(runtime?.activities ?? []);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [lastTurnId, setLastTurnId] = React.useState("");
  if (!graph?.activeThreadId && !agentTree.length) return null;
  async function refreshThreads() {
    setBusy(true);
    setMessage(null);
    try {
      mergeThreads(roomId, await listCodexThreads(roomId, projectPath));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function forkActiveThread() {
    if (!graph?.activeThreadId) return;
    setBusy(true);
    setMessage(null);
    try {
      const node = await forkCodexThread(roomId, graph.activeThreadId, projectPath, lastTurnId.trim() || undefined);
      addFork(roomId, node);
      setRoomGoal(roomId, null);
      setLastTurnId("");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function switchThread(threadId: string) {
    setActiveThread(roomId, threadId);
    try {
      const goal = await getCodexGoal(roomId, threadId);
      setRoomGoal(roomId, goal ? codexGoalToRoomGoal(goal) : null);
    } catch (error) {
      reportNonFatal("load Codex goal while switching threads", error);
      setRoomGoal(roomId, null);
    }
  }

  return (
    <CodexThreadGraphView
      graph={graph ?? { activeThreadId: null, nodesById: {} }}
      agentTree={agentTree}
      busy={busy}
      message={message}
      lastTurnId={lastTurnId}
      onLastTurnIdChange={setLastTurnId}
      onRefresh={() => void refreshThreads()}
      onFork={() => void forkActiveThread()}
      onSwitch={(threadId) => void switchThread(threadId)}
    />
  );
}

export function CodexThreadGraphView({
  graph,
  agentTree,
  busy,
  message,
  lastTurnId,
  onLastTurnIdChange,
  onRefresh,
  onFork,
  onSwitch
}: {
  graph: CodexThreadGraph;
  agentTree: CodexAgentTreeNode[];
  busy: boolean;
  message: string | null;
  lastTurnId: string;
  onLastTurnIdChange: (value: string) => void;
  onRefresh: () => void;
  onFork: () => void;
  onSwitch: (threadId: string) => void;
}) {
  const nodes = Object.values(graph.nodesById).sort((a, b) => a.createdAt - b.createdAt);
  return (
    <section className="panel codex-thread-graph" aria-label="Codex thread graph">
      {graph?.activeThreadId ? (
        <>
          <header>
            <strong>Thread graph</strong>
            <button type="button" disabled={busy} onClick={onRefresh}>
              Refresh
            </button>
          </header>
          <ol>
            {nodes.map((node) => (
              <li key={node.id} data-active={node.id === graph.activeThreadId}>
                <span className="codex-tree-icon" aria-hidden="true">
                  {node.parentThreadId ? <CornerDownRight size={14} /> : <Circle size={8} fill="currentColor" />}
                </span>
                <div>
                  <strong>{node.title}</strong>
                  <small>
                    {shortId(node.id)} · {node.status}
                  </small>
                </div>
                {node.id === graph.activeThreadId ? (
                  <em>Active</em>
                ) : (
                  <button type="button" disabled={busy} onClick={() => onSwitch(node.id)}>
                    Switch
                  </button>
                )}
              </li>
            ))}
          </ol>
          <div className="codex-thread-fork-controls">
            <input
              aria-label="Last turn ID (optional)"
              placeholder="Last turn ID (optional)"
              value={lastTurnId}
              onChange={(event) => onLastTurnIdChange(event.target.value)}
            />
            <button type="button" disabled={busy} onClick={onFork}>
              Fork active
            </button>
          </div>
        </>
      ) : null}
      {agentTree.length ? (
        <div className="codex-agent-tree" aria-label="Codex agent tree">
          <strong>Agent tree</strong>
          <ol>
            {agentTree.map((agent) => (
              <li key={agent.id}>
                <span className="codex-tree-icon" aria-hidden="true">
                  {agent.parentId ? <CornerDownRight size={14} /> : <Circle size={8} fill="currentColor" />}
                </span>
                <div>
                  <strong>{shortId(agent.id)}</strong>
                  <small>
                    {agent.lastAction} · {agent.status}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
