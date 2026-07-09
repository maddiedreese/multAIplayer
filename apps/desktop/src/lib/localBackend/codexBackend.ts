import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./runtime";
import type { CodexGoal, CodexGoalStatus, CodexProbe, CodexTurnResult } from "./types";

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
  cwd: string,
  input: string,
  model = "gpt-5.5",
  reasoningEffort = "medium",
  speed = "standard",
  sandboxLevel = "workspace_write",
  previousThreadId: string | null = null,
  timeoutSeconds = 180
): Promise<CodexTurnResult> {
  if (isTauriRuntime()) {
    return invoke<CodexTurnResult>("run_codex_turn", {
      request: {
        roomId,
        cwd,
        input,
        model,
        reasoningEffort,
        speed,
        sandboxLevel,
        previousThreadId,
        timeoutSeconds
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
    stderr: ""
  };
}

export async function shutdownCodexRoom(roomId: string): Promise<number> {
  if (!isTauriRuntime()) return 0;
  return invoke<number>("shutdown_codex_room", {
    request: { roomId }
  });
}
