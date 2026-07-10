import type { ApprovalPolicy } from "@multaiplayer/protocol";
import type { StateCreator } from "zustand";
import type { LocalHistorySettings } from "../../lib/localHistory";
import { loadTeamHistorySettings } from "../../lib/localHistory";
import { loadTeamRoomDefaults, sanitizeTeamRoomDefaults } from "../../lib/teamRoomDefaults";
import type { AppStoreState } from "../appStore";

export interface HistoryDefaultsState {
  historySettings: LocalHistorySettings;
  teamHistorySettings: LocalHistorySettings;
  teamDefaultApprovalPolicy: ApprovalPolicy;
  teamDefaultCodexModel: string;
  teamDefaultBrowserProfilePersistent: boolean;
  teamDefaultInviteApprovalGate: boolean;
}

export interface HistoryDefaultsSlice extends HistoryDefaultsState {
  setHistorySettings: (settings: LocalHistorySettings) => void;
  setTeamHistorySettings: (settings: LocalHistorySettings) => void;
  setTeamDefaultApprovalPolicy: (approvalPolicy: ApprovalPolicy) => void;
  setTeamDefaultCodexModel: (codexModel: string) => void;
  setTeamDefaultBrowserProfilePersistent: (persistent: boolean) => void;
  setTeamDefaultInviteApprovalGate: (enabled: boolean) => void;
  loadDefaultsForTeam: (teamId: string) => void;
}

const defaultHistorySettings: LocalHistorySettings = {
  enabled: true,
  retentionDays: 30
};

const defaultTeamRoomSettings = sanitizeTeamRoomDefaults({});

export const emptyHistoryDefaultsState: HistoryDefaultsState = {
  historySettings: { ...defaultHistorySettings },
  teamHistorySettings: { ...defaultHistorySettings },
  teamDefaultApprovalPolicy: defaultTeamRoomSettings.approvalPolicy,
  teamDefaultCodexModel: defaultTeamRoomSettings.codexModel,
  teamDefaultBrowserProfilePersistent: defaultTeamRoomSettings.browserProfilePersistent,
  teamDefaultInviteApprovalGate: defaultTeamRoomSettings.inviteApprovalGate
};

export function loadHistoryDefaultsState(
  teamId: string
): Pick<
  HistoryDefaultsState,
  | "teamHistorySettings"
  | "teamDefaultApprovalPolicy"
  | "teamDefaultCodexModel"
  | "teamDefaultBrowserProfilePersistent"
  | "teamDefaultInviteApprovalGate"
> {
  const teamHistorySettings = loadTeamHistorySettings(teamId);
  const teamRoomDefaults = loadTeamRoomDefaults(teamId);
  return {
    teamHistorySettings,
    teamDefaultApprovalPolicy: teamRoomDefaults.approvalPolicy,
    teamDefaultCodexModel: teamRoomDefaults.codexModel,
    teamDefaultBrowserProfilePersistent: teamRoomDefaults.browserProfilePersistent,
    teamDefaultInviteApprovalGate: teamRoomDefaults.inviteApprovalGate
  };
}

export const createHistoryDefaultsSlice: StateCreator<AppStoreState, [], [], HistoryDefaultsSlice> = (set) => ({
  ...emptyHistoryDefaultsState,
  setHistorySettings: (historySettings) => set({ historySettings }),
  setTeamHistorySettings: (teamHistorySettings) => set({ teamHistorySettings }),
  setTeamDefaultApprovalPolicy: (teamDefaultApprovalPolicy) => set({ teamDefaultApprovalPolicy }),
  setTeamDefaultCodexModel: (teamDefaultCodexModel) => set({ teamDefaultCodexModel }),
  setTeamDefaultBrowserProfilePersistent: (teamDefaultBrowserProfilePersistent) =>
    set({ teamDefaultBrowserProfilePersistent }),
  setTeamDefaultInviteApprovalGate: (teamDefaultInviteApprovalGate) => set({ teamDefaultInviteApprovalGate }),
  loadDefaultsForTeam: (teamId) => set(loadHistoryDefaultsState(teamId))
});
