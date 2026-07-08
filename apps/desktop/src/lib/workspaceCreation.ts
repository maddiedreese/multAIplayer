import { codexModelOptions, codexReasoningEffortOptions, codexSpeedOptions } from "@multaiplayer/protocol";

export interface WorkspaceCreatePlan {
  name: string;
}

export interface RoomCreatePlan {
  teamId: string;
  name: string;
  projectPath: string;
}

export const maxTeamNameChars = 120;
export const maxRoomNameChars = 160;
export const maxRoomProjectPathChars = 2048;
export const maxCodexModelChars = 80;

const controlCharacters = /[\u0000-\u001f\u007f]/;

function normalizeBoundedText(value: string, maxChars: number): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxChars) return null;
  if (controlCharacters.test(trimmed)) return null;
  return trimmed;
}

export function normalizeTeamName(name: string): string | null {
  return normalizeBoundedText(name, maxTeamNameChars);
}

export function normalizeRoomName(name: string): string | null {
  return normalizeBoundedText(name, maxRoomNameChars);
}

export function normalizeProjectPath(projectPath: string): string | null {
  return normalizeBoundedText(projectPath, maxRoomProjectPathChars);
}

export function normalizeCodexModel(model: string): string | null {
  const trimmed = model.trim();
  if (!trimmed || trimmed.length > maxCodexModelChars) return null;
  if (codexModelOptions.some((option) => option.id === trimmed)) return trimmed;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(trimmed)) return null;
  return trimmed;
}

export function normalizeCodexReasoningEffort(effort: string): string | null {
  const trimmed = effort.trim();
  return codexReasoningEffortOptions.some((option) => option.id === trimmed) ? trimmed : null;
}

export function normalizeCodexSpeed(speed: string): string | null {
  const trimmed = speed.trim();
  return codexSpeedOptions.some((option) => option.id === trimmed) ? trimmed : null;
}

export function planTeamCreation(name: string): WorkspaceCreatePlan {
  const trimmedName = normalizeTeamName(name);
  if (!trimmedName) throw new Error(`Enter a team name up to ${maxTeamNameChars} characters without control characters.`);
  return { name: trimmedName };
}

export function planRoomCreation(teamId: string, name: string, projectPath: string): RoomCreatePlan {
  if (!teamId) throw new Error("Create or select a team before creating a room.");
  const trimmedName = normalizeRoomName(name);
  if (!trimmedName) throw new Error(`Enter a room name up to ${maxRoomNameChars} characters without control characters.`);
  const trimmedProjectPath = normalizeProjectPath(projectPath);
  if (!trimmedProjectPath) {
    throw new Error(`Enter or choose a local project folder up to ${maxRoomProjectPathChars} characters without control characters.`);
  }
  return {
    teamId,
    name: trimmedName,
    projectPath: trimmedProjectPath
  };
}
