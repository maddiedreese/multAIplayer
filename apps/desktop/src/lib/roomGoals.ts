import type { RoomGoal } from "../types";

export const maxRoomGoalTextLength = 2000;

export function parseRoomGoalCommand(input: string): string | null {
  const match = input.match(/^\/goals?\b(?::)?\s*([\s\S]*)$/i);
  if (!match) return null;
  const goal = sanitizeRoomGoalText(match[1] ?? "");
  return goal || null;
}

export function sanitizeRoomGoalText(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, maxRoomGoalTextLength);
}

export function createRoomGoal(text: string, now = new Date()): RoomGoal {
  const timestamp = now.toISOString();
  return {
    id: `goal-${now.getTime().toString(36)}`,
    text: sanitizeRoomGoalText(text),
    status: "running",
    startedAt: timestamp,
    updatedAt: timestamp,
    elapsedMs: 0
  };
}

export function updateRoomGoalElapsed(goal: RoomGoal, now = new Date()): RoomGoal {
  if (goal.status !== "running") return goal;
  const startedAt = Date.parse(goal.updatedAt);
  const delta = Number.isFinite(startedAt) ? Math.max(0, now.getTime() - startedAt) : 0;
  return {
    ...goal,
    elapsedMs: goal.elapsedMs + delta,
    updatedAt: now.toISOString()
  };
}

export function pauseRoomGoal(goal: RoomGoal, now = new Date()): RoomGoal {
  return {
    ...updateRoomGoalElapsed(goal, now),
    status: "paused",
    updatedAt: now.toISOString()
  };
}

export function resumeRoomGoal(goal: RoomGoal, now = new Date()): RoomGoal {
  return {
    ...goal,
    status: "running",
    updatedAt: now.toISOString()
  };
}

export function editRoomGoal(goal: RoomGoal, text: string, now = new Date()): RoomGoal {
  return {
    ...goal,
    text: sanitizeRoomGoalText(text),
    updatedAt: now.toISOString()
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
