import type { RoomGoal } from "../../types";

export const maxRoomGoalTextLength = 2000;

export function parseRoomGoalCommand(input: string): string | null {
  const match = input.match(/^\/goal\b(?::)?\s*([\s\S]*)$/i);
  if (!match) return null;
  const goal = sanitizeRoomGoalText(match[1] ?? "");
  return goal || null;
}

export function sanitizeRoomGoalText(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, maxRoomGoalTextLength);
}

export function updateRoomGoalElapsed(goal: RoomGoal, now = new Date()): RoomGoal {
  if (goal.status !== "active") return goal;
  const startedAt = Date.parse(goal.updatedAt);
  const delta = Number.isFinite(startedAt) ? Math.max(0, now.getTime() - startedAt) : 0;
  return {
    ...goal,
    elapsedMs: goal.elapsedMs + delta,
    updatedAt: now.toISOString()
  };
}

export function codexGoalToRoomGoal(value: {
  objective: string;
  status: RoomGoal["status"];
  createdAt: number;
  updatedAt: number;
  timeUsedSeconds: number;
  tokensUsed: number;
  tokenBudget?: number | null;
}): RoomGoal {
  return {
    id: `codex-goal-${value.createdAt}`,
    text: value.objective,
    status: value.status,
    startedAt: new Date(value.createdAt * 1000).toISOString(),
    updatedAt: new Date(value.updatedAt * 1000).toISOString(),
    elapsedMs: value.timeUsedSeconds * 1000,
    tokensUsed: value.tokensUsed,
    tokenBudget: value.tokenBudget ?? null
  };
}

export function formatRoomGoalDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
