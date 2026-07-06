import type { ApprovalPolicy } from "@multaiplayer/protocol";
import {
  loadTeamRoomDefaults,
  saveTeamRoomDefaults
} from "../lib/teamRoomDefaults";
import {
  saveTeamHistorySettings,
  type LocalHistorySettings
} from "../lib/localHistory";
import { formatCodexModel } from "../lib/appFormatters";

interface UseTeamDefaultActionsOptions {
  selectedTeam: string;
  approvalPolicyLabels: Record<string, string>;
  setSelectedTeamHistoryMessage: (message: string | null) => void;
  setTeamHistoryMessageForTeam: (teamId: string, message: string | null) => void;
  setTeamHistorySettings: (settings: LocalHistorySettings) => void;
  setTeamDefaultApprovalPolicy: (approvalPolicy: ApprovalPolicy) => void;
  setTeamDefaultCodexModel: (codexModel: string) => void;
  setTeamDefaultBrowserProfilePersistent: (browserProfilePersistent: boolean) => void;
  setTeamDefaultInviteApprovalGate: (inviteApprovalGate: boolean) => void;
}

export function useTeamDefaultActions({
  selectedTeam,
  approvalPolicyLabels,
  setSelectedTeamHistoryMessage,
  setTeamHistoryMessageForTeam,
  setTeamHistorySettings,
  setTeamDefaultApprovalPolicy,
  setTeamDefaultCodexModel,
  setTeamDefaultBrowserProfilePersistent,
  setTeamDefaultInviteApprovalGate
}: UseTeamDefaultActionsOptions) {
  function updateTeamHistoryDefaults(next: LocalHistorySettings) {
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team history defaults.");
      return;
    }
    const teamId = selectedTeam;
    const saved = saveTeamHistorySettings(selectedTeam, next);
    setTeamHistorySettings(saved);
    setTeamHistoryMessageForTeam(
      teamId,
      saved.enabled
        ? `Team default local history retention set to ${saved.retentionDays} days for new rooms.`
        : "Team default local history is disabled for new rooms."
    );
  }

  function updateTeamDefaultApprovalPolicy(approvalPolicy: ApprovalPolicy) {
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team defaults.");
      return;
    }
    const saved = saveTeamRoomDefaults(selectedTeam, {
      ...loadTeamRoomDefaults(selectedTeam),
      approvalPolicy
    });
    setTeamDefaultApprovalPolicy(saved.approvalPolicy);
    setTeamDefaultCodexModel(saved.codexModel);
    setTeamDefaultBrowserProfilePersistent(saved.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(saved.inviteApprovalGate);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      `New rooms in this team will default to ${approvalPolicyLabels[saved.approvalPolicy]}.`
    );
  }

  function updateTeamDefaultCodexModel(codexModel: string) {
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team defaults.");
      return;
    }
    const saved = saveTeamRoomDefaults(selectedTeam, {
      ...loadTeamRoomDefaults(selectedTeam),
      codexModel
    });
    setTeamDefaultApprovalPolicy(saved.approvalPolicy);
    setTeamDefaultCodexModel(saved.codexModel);
    setTeamDefaultBrowserProfilePersistent(saved.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(saved.inviteApprovalGate);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      `New rooms in this team will default to ${formatCodexModel(saved.codexModel)}.`
    );
  }

  function updateTeamDefaultInviteApprovalGate(inviteApprovalGate: boolean) {
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team defaults.");
      return;
    }
    const saved = saveTeamRoomDefaults(selectedTeam, {
      ...loadTeamRoomDefaults(selectedTeam),
      inviteApprovalGate
    });
    setTeamDefaultApprovalPolicy(saved.approvalPolicy);
    setTeamDefaultCodexModel(saved.codexModel);
    setTeamDefaultBrowserProfilePersistent(saved.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(saved.inviteApprovalGate);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      saved.inviteApprovalGate
        ? "New room invites in this team will require host approval by default."
        : "New room invites in this team will include the room key by default."
    );
  }

  return {
    updateTeamHistoryDefaults,
    updateTeamDefaultApprovalPolicy,
    updateTeamDefaultCodexModel,
    updateTeamDefaultInviteApprovalGate
  };
}
