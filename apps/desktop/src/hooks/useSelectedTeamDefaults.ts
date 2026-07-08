import { useEffect } from "react";
import type { ApprovalPolicy } from "@multaiplayer/protocol";
import { loadTeamHistorySettings, type LocalHistorySettings } from "../lib/localHistory";
import { loadTeamRoomDefaults } from "../lib/teamRoomDefaults";

interface UseSelectedTeamDefaultsOptions {
  selectedTeam: string;
  replaceTeamHistorySettings: (next: LocalHistorySettings) => void;
  replaceTeamDefaultApprovalPolicy: (next: ApprovalPolicy) => void;
  replaceTeamDefaultCodexModel: (next: string) => void;
  replaceTeamDefaultBrowserProfilePersistent: (next: boolean) => void;
  replaceTeamDefaultInviteApprovalGate: (next: boolean) => void;
}

export function useSelectedTeamDefaults({
  selectedTeam,
  replaceTeamHistorySettings,
  replaceTeamDefaultApprovalPolicy,
  replaceTeamDefaultCodexModel,
  replaceTeamDefaultBrowserProfilePersistent,
  replaceTeamDefaultInviteApprovalGate
}: UseSelectedTeamDefaultsOptions) {
  useEffect(() => {
    if (!selectedTeam) return;
    const teamRoomDefaults = loadTeamRoomDefaults(selectedTeam);
    replaceTeamHistorySettings(loadTeamHistorySettings(selectedTeam));
    replaceTeamDefaultApprovalPolicy(teamRoomDefaults.approvalPolicy);
    replaceTeamDefaultCodexModel(teamRoomDefaults.codexModel);
    replaceTeamDefaultBrowserProfilePersistent(teamRoomDefaults.browserProfilePersistent);
    replaceTeamDefaultInviteApprovalGate(teamRoomDefaults.inviteApprovalGate);
  }, [
    replaceTeamDefaultApprovalPolicy,
    replaceTeamDefaultBrowserProfilePersistent,
    replaceTeamDefaultCodexModel,
    replaceTeamDefaultInviteApprovalGate,
    replaceTeamHistorySettings,
    selectedTeam,
  ]);
}
