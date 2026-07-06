import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { ApprovalPolicy } from "@multaiplayer/protocol";
import { loadTeamHistorySettings, type LocalHistorySettings } from "../lib/localHistory";
import { loadTeamRoomDefaults } from "../lib/teamRoomDefaults";

interface UseSelectedTeamDefaultsOptions {
  selectedTeam: string;
  setTeamHistorySettings: Dispatch<SetStateAction<LocalHistorySettings>>;
  setTeamDefaultApprovalPolicy: Dispatch<SetStateAction<ApprovalPolicy>>;
  setTeamDefaultCodexModel: Dispatch<SetStateAction<string>>;
  setTeamDefaultBrowserProfilePersistent: Dispatch<SetStateAction<boolean>>;
  setTeamDefaultInviteApprovalGate: Dispatch<SetStateAction<boolean>>;
}

export function useSelectedTeamDefaults({
  selectedTeam,
  setTeamHistorySettings,
  setTeamDefaultApprovalPolicy,
  setTeamDefaultCodexModel,
  setTeamDefaultBrowserProfilePersistent,
  setTeamDefaultInviteApprovalGate
}: UseSelectedTeamDefaultsOptions) {
  useEffect(() => {
    if (!selectedTeam) return;
    const teamRoomDefaults = loadTeamRoomDefaults(selectedTeam);
    setTeamHistorySettings(loadTeamHistorySettings(selectedTeam));
    setTeamDefaultApprovalPolicy(teamRoomDefaults.approvalPolicy);
    setTeamDefaultCodexModel(teamRoomDefaults.codexModel);
    setTeamDefaultBrowserProfilePersistent(teamRoomDefaults.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(teamRoomDefaults.inviteApprovalGate);
  }, [
    selectedTeam,
    setTeamDefaultApprovalPolicy,
    setTeamDefaultBrowserProfilePersistent,
    setTeamDefaultCodexModel,
    setTeamDefaultInviteApprovalGate,
    setTeamHistorySettings
  ]);
}
