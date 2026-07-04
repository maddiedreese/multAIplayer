import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  type ApprovalPolicy
} from "@multaiplayer/protocol";
import { normalizeBrowserAllowedOrigins } from "./browserPolicy";

export interface TeamRoomDefaults {
  approvalPolicy: ApprovalPolicy;
  browserAllowedOrigins: string[];
  browserProfilePersistent: boolean;
}

const defaultTeamRoomDefaults: TeamRoomDefaults = {
  approvalPolicy: "ask_every_turn",
  browserAllowedOrigins: [...defaultBrowserAllowedOrigins],
  browserProfilePersistent: defaultBrowserProfilePersistent
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
    return defaultTeamRoomDefaults;
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
    browserAllowedOrigins: [...(browserAllowedOrigins ?? defaultTeamRoomDefaults.browserAllowedOrigins)],
    browserProfilePersistent: typeof defaults.browserProfilePersistent === "boolean"
      ? defaults.browserProfilePersistent
      : defaultTeamRoomDefaults.browserProfilePersistent
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
