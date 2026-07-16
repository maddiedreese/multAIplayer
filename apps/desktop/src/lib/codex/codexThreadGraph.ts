import { isRecord, maxCodexThreadIdChars } from "@multaiplayer/protocol";
import type { CodexActivity, CodexAgentTreeNode, CodexThreadGraph, CodexThreadGraphNode } from "../../types";
import { normalizeCodexThreadId } from "./codexThread";

export const maxCodexThreadGraphNodes = 160;

export function emptyCodexThreadGraph(): CodexThreadGraph {
  return { activeThreadId: null, nodesById: {} };
}

export function normalizeCodexThreadGraph(value: unknown): CodexThreadGraph {
  if (!isRecord(value) || Array.isArray(value)) return emptyCodexThreadGraph();
  const rawNodes = isRecord(value.nodesById) && !Array.isArray(value.nodesById) ? Object.values(value.nodesById) : [];
  const nodes = rawNodes.map(normalizeNode).filter((node): node is CodexThreadGraphNode => Boolean(node));
  const bounded = nodes.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxCodexThreadGraphNodes);
  const nodesById = Object.fromEntries(bounded.map((node) => [node.id, node]));
  const requestedActive = normalizeCodexThreadId(value.activeThreadId);
  const activeThreadId = requestedActive && nodesById[requestedActive] ? requestedActive : (bounded[0]?.id ?? null);
  return { activeThreadId: activeThreadId ?? null, nodesById };
}

export function mergeCodexThreadGraph(
  graph: CodexThreadGraph,
  nodes: readonly CodexThreadGraphNode[]
): CodexThreadGraph {
  const activeNode = graph.activeThreadId ? nodes.find((node) => node.id === graph.activeThreadId) : undefined;
  const sessionId =
    activeNode?.sessionId ?? (graph.activeThreadId ? graph.nodesById[graph.activeThreadId]?.sessionId : undefined);
  const eligible = sessionId
    ? nodes.filter((node) => node.sessionId === sessionId)
    : graph.activeThreadId
      ? nodes.filter((node) => node.id === graph.activeThreadId)
      : [];
  return normalizeCodexThreadGraph({
    activeThreadId: graph.activeThreadId,
    nodesById: { ...graph.nodesById, ...Object.fromEntries(eligible.map((node) => [node.id, node])) }
  });
}

export function deriveCodexAgentTree(activities: readonly CodexActivity[]): CodexAgentTreeNode[] {
  const nodes = new Map<string, CodexAgentTreeNode>();
  for (const activity of activities) {
    if (activity.kind !== "agent" || !activity.agent) continue;
    const { action, senderId, receiverIds } = activity.agent;
    if (!nodes.has(senderId)) {
      nodes.set(senderId, {
        id: senderId,
        parentId: null,
        status: activity.status,
        lastAction: action,
        updatedAt: activity.updatedAt
      });
    }
    nodes.set(senderId, {
      ...nodes.get(senderId)!,
      status: activity.status,
      lastAction: action,
      updatedAt: activity.updatedAt
    });
    for (const receiverId of receiverIds) {
      const existing = nodes.get(receiverId);
      nodes.set(receiverId, {
        id: receiverId,
        parentId: action === "spawn" ? senderId : (existing?.parentId ?? null),
        status: activity.status,
        lastAction: action,
        updatedAt: activity.updatedAt
      });
    }
  }
  return [...nodes.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

function normalizeNode(value: unknown): CodexThreadGraphNode | null {
  if (!isRecord(value) || Array.isArray(value)) return null;
  const id = normalizeCodexThreadId(value.id);
  if (!id) return null;
  const parentThreadId = normalizeCodexThreadId(value.parentThreadId);
  const sessionId = normalizeCodexThreadId(value.sessionId);
  const status = ["notLoaded", "idle", "systemError", "active", "unknown"].includes(String(value.status))
    ? (value.status as CodexThreadGraphNode["status"])
    : "unknown";
  const title =
    typeof value.title === "string"
      ? [...value.title]
          .filter((character) => !/\p{Cc}/u.test(character))
          .slice(0, maxCodexThreadIdChars)
          .join("")
          .trim()
      : "";
  return {
    id,
    ...(sessionId ? { sessionId } : {}),
    ...(parentThreadId ? { parentThreadId } : {}),
    title: title || "Codex thread",
    status,
    createdAt: safeTimestamp(value.createdAt),
    updatedAt: safeTimestamp(value.updatedAt)
  };
}

function safeTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
