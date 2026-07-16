import { invokeNative } from "../nativeCommandError";
import { defaultCodexModel } from "@multaiplayer/protocol";

import { isTauriRuntime, requireNativeRuntime } from "./runtime";
import type {
  CodexGoal,
  CodexGoalStatus,
  CodexProbe,
  CodexServerRequest,
  CodexServerResponse,
  CodexSteerResult,
  CodexThreadNode,
  CodexTurnResult
} from "./types";

export async function listCodexThreads(roomId: string, cwd: string, limit = 100): Promise<CodexThreadNode[]> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex threads");
  return invokeNative<CodexThreadNode[]>("list_codex_threads", { request: { roomId, cwd, limit } });
}

export async function forkCodexThread(
  roomId: string,
  threadId: string,
  cwd: string,
  lastTurnId?: string
): Promise<CodexThreadNode> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex thread forks");
  return invokeNative<CodexThreadNode>("fork_codex_thread", {
    request: { roomId, threadId, cwd, ...(lastTurnId ? { lastTurnId } : {}) }
  });
}

export async function setCodexGoal(
  roomId: string,
  threadId: string,
  objective: string | null,
  status?: CodexGoalStatus,
  tokenBudget?: number | null
): Promise<CodexGoal> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex goals");
  return invokeNative<CodexGoal>("set_codex_goal", {
    request: { roomId, threadId, objective, status, tokenBudget }
  });
}

export async function getCodexGoal(roomId: string, threadId: string): Promise<CodexGoal | null> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex goals");
  return invokeNative<CodexGoal | null>("get_codex_goal", {
    request: { roomId, threadId }
  });
}

export async function clearCodexGoal(roomId: string, threadId: string): Promise<void> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex goals");
  await invokeNative("clear_codex_goal", {
    request: { roomId, threadId }
  });
}

export async function probeCodex(): Promise<CodexProbe> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex detection");
  return invokeNative<CodexProbe>("probe_codex");
}

export async function runCodexTurn(
  roomId: string,
  clientTurnId: string,
  cwd: string,
  input: string,
  model = defaultCodexModel,
  reasoningEffort = "medium",
  speed = "standard",
  serviceTier: string | null = null,
  sandboxLevel = "workspace_write",
  previousThreadId: string | null = null,
  timeoutSeconds = 180,
  provenance: { proposedBy: string; contextSummary: string } | null = null,
  shareRawReasoning = false
): Promise<CodexTurnResult> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex turns");
  return invokeNative<CodexTurnResult>("run_codex_turn", {
    request: {
      roomId,
      clientTurnId,
      cwd,
      input,
      model,
      reasoningEffort,
      speed,
      serviceTier,
      sandboxLevel,
      previousThreadId,
      timeoutSeconds,
      proposedBy: provenance?.proposedBy ?? null,
      contextSummary: provenance?.contextSummary ?? null,
      shareRawReasoning
    }
  });
}

export async function steerCodexTurn(roomId: string, input: string): Promise<CodexSteerResult> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex steering");
  return invokeNative<CodexSteerResult>("steer_codex_turn", { request: { roomId, input } });
}

export async function shutdownCodexRoom(roomId: string): Promise<number> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex rooms");
  return invokeNative<number>("shutdown_codex_room", {
    request: { roomId }
  });
}

export async function listCodexServerRequests(): Promise<CodexServerRequest[]> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex server requests");
  return invokeNative<CodexServerRequest[]>("list_codex_server_requests");
}

export async function respondCodexServerRequest(requestKey: string, response: CodexServerResponse): Promise<void> {
  if (!isTauriRuntime()) return requireNativeRuntime("Codex server requests");
  await invokeNative("respond_codex_server_request", {
    request: { requestKey, response }
  });
}
