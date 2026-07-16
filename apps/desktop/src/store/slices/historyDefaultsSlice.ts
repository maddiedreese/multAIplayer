import type { ApprovalPolicy } from "@multaiplayer/protocol";
import type { StateCreator } from "zustand";
import type { LocalHistorySettings } from "../../lib/history/localHistory";
import { loadTeamHistorySettings } from "../../lib/history/localHistory";
import { loadTeamRoomDefaults, sanitizeTeamRoomDefaults } from "../../lib/team/teamRoomDefaults";
import type { AppStoreState } from "../appStore";

export interface HistoryDefaultsState {
  historySettings: LocalHistorySettings;
  teamHistorySettings: LocalHistorySettings;
  teamDefaultApprovalPolicy: ApprovalPolicy;
  teamDefaultCodexModel: string;
  teamDefaultInviteApprovalGate: boolean;
}

export interface HistoryDefaultsSlice extends HistoryDefaultsState {
  setHistorySettings: (settings: LocalHistorySettings) => void;
  setTeamHistorySettings: (settings: LocalHistorySettings) => void;
  setTeamDefaultApprovalPolicy: (approvalPolicy: ApprovalPolicy) => void;
  setTeamDefaultCodexModel: (codexModel: string) => void;
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
  teamDefaultInviteApprovalGate: defaultTeamRoomSettings.inviteApprovalGate
};

export function loadHistoryDefaultsState(
  teamId: string
): Pick<
  HistoryDefaultsState,
  "teamHistorySettings" | "teamDefaultApprovalPolicy" | "teamDefaultCodexModel" | "teamDefaultInviteApprovalGate"
> {
  const teamHistorySettings = loadTeamHistorySettings(teamId);
  const teamRoomDefaults = loadTeamRoomDefaults(teamId);
  return {
    teamHistorySettings,
    teamDefaultApprovalPolicy: teamRoomDefaults.approvalPolicy,
    teamDefaultCodexModel: teamRoomDefaults.codexModel,
    teamDefaultInviteApprovalGate: teamRoomDefaults.inviteApprovalGate
  };
}

export const createHistoryDefaultsSlice: StateCreator<AppStoreState, [], [], HistoryDefaultsSlice> = (set) => ({
  ...emptyHistoryDefaultsState,
  setHistorySettings: (historySettings) => set({ historySettings }),
  setTeamHistorySettings: (teamHistorySettings) => set({ teamHistorySettings }),
  setTeamDefaultApprovalPolicy: (teamDefaultApprovalPolicy) => set({ teamDefaultApprovalPolicy }),
  setTeamDefaultCodexModel: (teamDefaultCodexModel) => set({ teamDefaultCodexModel }),
  setTeamDefaultInviteApprovalGate: (teamDefaultInviteApprovalGate) => set({ teamDefaultInviteApprovalGate }),
  loadDefaultsForTeam: (teamId) => set(loadHistoryDefaultsState(teamId))
});
