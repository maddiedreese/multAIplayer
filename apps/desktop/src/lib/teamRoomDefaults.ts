import {
  defaultCodexModel,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  type ApprovalPolicy
} from "@multaiplayer/protocol";
import { normalizeBrowserAllowedOrigins } from "./browserPolicy";
import { normalizeCodexModel } from "./workspaceCreation";

export interface TeamRoomDefaults {
  approvalPolicy: ApprovalPolicy;
  codexModel: string;
  browserAllowedOrigins: string[];
  browserProfilePersistent: boolean;
  inviteApprovalGate: boolean;
}

export function isRoomSettingsMutationInFlight(
  busyByRoom: Record<string, boolean>,
  roomId: string
): boolean {
  return busyByRoom[roomId] === true;
}

export function roomSettingsMutationInFlightMessage(): string {
  return "Room settings are already being updated.";
}

const defaultTeamRoomDefaults: TeamRoomDefaults = {
  approvalPolicy: "ask_every_turn",
  codexModel: defaultCodexModel,
  browserAllowedOrigins: [...defaultBrowserAllowedOrigins],
  browserProfilePersistent: defaultBrowserProfilePersistent,
  inviteApprovalGate: false
};

const approvalPolicies: ApprovalPolicy[] = [
  "ask_every_turn",
  "auto_chat_only",
  "auto_browser_allowed_sites",
  "never_host"
];

export function loadTeamRoomDefaults(teamId: string): TeamRoomDefaults {
  const stored = localStorage.getItem(teamRoomDefaultsKey(teamId));
  if (!stored) return copyTeamRoomDefaults(defaultTeamRoomDefaults);
  try {
    return sanitizeTeamRoomDefaults(JSON.parse(stored) as Partial<TeamRoomDefaults>);
  } catch {
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
  const browserAllowedOrigins = defaults.browserAllowedOrigins === undefined
    ? defaultTeamRoomDefaults.browserAllowedOrigins
    : normalizeBrowserAllowedOrigins(defaults.browserAllowedOrigins);
  return {
    approvalPolicy: isApprovalPolicy(defaults.approvalPolicy)
      ? defaults.approvalPolicy
      : defaultTeamRoomDefaults.approvalPolicy,
    codexModel: normalizeCodexModel(defaults.codexModel ?? "") ?? defaultTeamRoomDefaults.codexModel,
    browserAllowedOrigins: [...(browserAllowedOrigins ?? defaultTeamRoomDefaults.browserAllowedOrigins)],
    browserProfilePersistent: typeof defaults.browserProfilePersistent === "boolean"
      ? defaults.browserProfilePersistent
      : defaultTeamRoomDefaults.browserProfilePersistent,
    inviteApprovalGate: typeof defaults.inviteApprovalGate === "boolean"
      ? defaults.inviteApprovalGate
      : defaultTeamRoomDefaults.inviteApprovalGate
  };
}

export function teamDefaultsRoomSettings(defaults: TeamRoomDefaults): Pick<
  TeamRoomDefaults,
  "approvalPolicy" | "codexModel" | "browserAllowedOrigins" | "browserProfilePersistent"
> {
  const sanitized = sanitizeTeamRoomDefaults(defaults);
  return {
    approvalPolicy: sanitized.approvalPolicy,
    codexModel: sanitized.codexModel,
    browserAllowedOrigins: [...sanitized.browserAllowedOrigins],
    browserProfilePersistent: sanitized.browserProfilePersistent
  };
}

function copyTeamRoomDefaults(defaults: TeamRoomDefaults): TeamRoomDefaults {
  return {
    ...defaults,
    browserAllowedOrigins: [...defaults.browserAllowedOrigins]
  };
}

export function teamRoomDefaultsKey(teamId: string): string {
  return `multaiplayer:team-room-defaults:${teamId}`;
}

function isApprovalPolicy(value: unknown): value is ApprovalPolicy {
  return typeof value === "string" && approvalPolicies.includes(value as ApprovalPolicy);
}
