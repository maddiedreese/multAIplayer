import { invoke } from "@tauri-apps/api/core";
import { defaultCodexModel } from "@multaiplayer/protocol";

import { isTauriRuntime } from "./runtime";
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
  if (!isTauriRuntime()) return [];
  return invoke<CodexThreadNode[]>("list_codex_threads", { request: { roomId, cwd, limit } });
}

export async function forkCodexThread(
  roomId: string,
  threadId: string,
  cwd: string,
  lastTurnId?: string
): Promise<CodexThreadNode> {
  if (!isTauriRuntime()) {
    const now = Math.floor(Date.now() / 1000);
    return {
      id: `${threadId}-fork`,
      parentThreadId: threadId,
      title: "Forked Codex thread",
      status: "idle",
      createdAt: now,
      updatedAt: now
    };
  }
  return invoke<CodexThreadNode>("fork_codex_thread", {
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
  if (isTauriRuntime()) {
    return invoke<CodexGoal>("set_codex_goal", {
      request: { roomId, threadId, objective, status, tokenBudget }
    });
  }

  const now = Math.floor(Date.now() / 1000);
  return {
    objective: objective ?? "Preview Codex goal",
    status: status ?? "active",
    threadId,
    createdAt: now,
    updatedAt: now,
    timeUsedSeconds: 0,
    tokensUsed: 0,
    tokenBudget: tokenBudget ?? null
  };
}

export async function getCodexGoal(roomId: string, threadId: string): Promise<CodexGoal | null> {
  if (isTauriRuntime()) {
    return invoke<CodexGoal | null>("get_codex_goal", {
      request: { roomId, threadId }
    });
  }

  void roomId;
  void threadId;
  return null;
}

export async function clearCodexGoal(roomId: string, threadId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("clear_codex_goal", {
      request: { roomId, threadId }
    });
  }
}

export async function probeCodex(): Promise<CodexProbe> {
  if (isTauriRuntime()) {
    return invoke<CodexProbe>("probe_codex");
  }

  return {
    available: false,
    version: null,
    error: "Preview mode",
    models: [],
    modelError: null
  };
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
  if (isTauriRuntime()) {
    return invoke<CodexTurnResult>("run_codex_turn", {
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

  return {
    threadId: previousThreadId ?? "preview-thread",
    status: "preview",
    transcript:
      "Preview mode: in the native app, this approval starts a local Codex app-server turn using the selected project and chat delta.",
    events: [
      "preview:initialize",
      previousThreadId ? "preview:thread/resume" : "preview:thread/start",
      "preview:turn/start",
      "preview:turn/completed"
    ],
    generatedImages: [],
    stderr: ""
  };
}

export async function steerCodexTurn(roomId: string, input: string): Promise<CodexSteerResult> {
  if (isTauriRuntime()) {
    return invoke<CodexSteerResult>("steer_codex_turn", { request: { roomId, input } });
  }
  return {
    threadId: "preview-thread",
    turnId: "preview-active-turn",
    clientTurnId: "preview-client-turn"
  };
}

export async function shutdownCodexRoom(roomId: string): Promise<number> {
  if (!isTauriRuntime()) return 0;
  return invoke<number>("shutdown_codex_room", {
    request: { roomId }
  });
}

export async function listCodexServerRequests(): Promise<CodexServerRequest[]> {
  if (!isTauriRuntime()) return [];
  return invoke<CodexServerRequest[]>("list_codex_server_requests");
}

export async function respondCodexServerRequest(requestKey: string, response: CodexServerResponse): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("respond_codex_server_request", {
    request: { requestKey, response }
  });
}
