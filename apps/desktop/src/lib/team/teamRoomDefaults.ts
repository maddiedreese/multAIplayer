import { defaultCodexModel, type ApprovalPolicy } from "@multaiplayer/protocol";
import { normalizeCodexModel } from "../workspace/workspaceCreation";
import { reportNonFatal } from "../core/nonFatalReporting";

export interface TeamRoomDefaults {
  approvalPolicy: ApprovalPolicy;
  codexModel: string;
  inviteApprovalGate: boolean;
}

export function isRoomSettingsMutationInFlight(busyByRoom: Record<string, boolean>, roomId: string): boolean {
  return busyByRoom[roomId] === true;
}

export function roomSettingsMutationInFlightMessage(): string {
  return "Room settings are already being updated.";
}

const defaultTeamRoomDefaults: TeamRoomDefaults = {
  approvalPolicy: "ask_every_turn",
  codexModel: defaultCodexModel,
  inviteApprovalGate: true
};

const approvalPolicies: ApprovalPolicy[] = ["ask_every_turn", "never_host"];

export function loadTeamRoomDefaults(teamId: string): TeamRoomDefaults {
  const stored = localStorage.getItem(teamRoomDefaultsKey(teamId));
  if (!stored) return copyTeamRoomDefaults(defaultTeamRoomDefaults);
  try {
    return sanitizeTeamRoomDefaults(JSON.parse(stored) as Partial<TeamRoomDefaults>);
  } catch {
    reportNonFatal("discard corrupt team room defaults");
    localStorage.removeItem(teamRoomDefaultsKey(teamId));
    return copyTeamRoomDefaults(defaultTeamRoomDefaults);
  }
}

export function saveTeamRoomDefaults(teamId: string, defaults: TeamRoomDefaults): TeamRoomDefaults {
  const sanitized = sanitizeTeamRoomDefaults(defaults);
  localStorage.setItem(teamRoomDefaultsKey(teamId), JSON.stringify(sanitized));
  return sanitized;
}

export function sanitizeTeamRoomDefaults(defaults: Partial<TeamRoomDefaults>): TeamRoomDefaults {
  return {
    approvalPolicy: sanitizeApprovalPolicy(defaults.approvalPolicy),
    codexModel: normalizeCodexModel(defaults.codexModel ?? "") ?? defaultTeamRoomDefaults.codexModel,
    inviteApprovalGate: true
  };
}

export function teamDefaultsRoomSettings(
  defaults: TeamRoomDefaults
): Pick<TeamRoomDefaults, "approvalPolicy" | "codexModel"> {
  const sanitized = sanitizeTeamRoomDefaults(defaults);
  return {
    approvalPolicy: sanitized.approvalPolicy,
    codexModel: sanitized.codexModel
  };
}

function copyTeamRoomDefaults(defaults: TeamRoomDefaults): TeamRoomDefaults {
  return { ...defaults };
}

export function teamRoomDefaultsKey(teamId: string): string {
  return `multaiplayer:team-room-defaults:${teamId}`;
}

function isApprovalPolicy(value: unknown): value is ApprovalPolicy {
  return typeof value === "string" && approvalPolicies.includes(value as ApprovalPolicy);
}

function sanitizeApprovalPolicy(value: unknown): ApprovalPolicy {
  return isApprovalPolicy(value) ? value : defaultTeamRoomDefaults.approvalPolicy;
}
