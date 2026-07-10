import type { ApprovalPolicy } from "@multaiplayer/protocol";
import { formatCodexModel } from "./appFormatters";
import { saveTeamHistorySettings, type LocalHistorySettings } from "./localHistory";
import { loadTeamRoomDefaults, saveTeamRoomDefaults } from "./teamRoomDefaults";
import { useAppStore } from "../store/appStore";

interface TeamDefaultActionsOptions {
  approvalPolicyLabels: Record<string, string>;
  setSelectedTeamHistoryMessage: (message: string | null) => void;
  setTeamHistoryMessageForTeam: (teamId: string, message: string | null) => void;
  setTeamHistorySettings: (settings: LocalHistorySettings) => void;
  setTeamDefaultApprovalPolicy: (approvalPolicy: ApprovalPolicy) => void;
  setTeamDefaultCodexModel: (codexModel: string) => void;
  setTeamDefaultBrowserProfilePersistent: (browserProfilePersistent: boolean) => void;
  setTeamDefaultInviteApprovalGate: (inviteApprovalGate: boolean) => void;
}

export function createTeamDefaultActions({
  approvalPolicyLabels,
  setSelectedTeamHistoryMessage,
  setTeamHistoryMessageForTeam,
  setTeamHistorySettings,
  setTeamDefaultApprovalPolicy,
  setTeamDefaultCodexModel,
  setTeamDefaultBrowserProfilePersistent,
  setTeamDefaultInviteApprovalGate
}: TeamDefaultActionsOptions) {
  function updateTeamHistoryDefaults(next: LocalHistorySettings) {
    const { selectedTeam } = useAppStore.getState();
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team history defaults.");
      return;
    }
    const saved = saveTeamHistorySettings(selectedTeam, next);
    setTeamHistorySettings(saved);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      saved.enabled
        ? `Team default local history retention set to ${saved.retentionDays} days for new rooms.`
        : "Team default local history is disabled for new rooms."
    );
  }

  function applySavedDefaults(saved: ReturnType<typeof saveTeamRoomDefaults>) {
    setTeamDefaultApprovalPolicy(saved.approvalPolicy);
    setTeamDefaultCodexModel(saved.codexModel);
    setTeamDefaultBrowserProfilePersistent(saved.browserProfilePersistent);
    setTeamDefaultInviteApprovalGate(saved.inviteApprovalGate);
  }

  function updateTeamDefaultApprovalPolicy(approvalPolicy: ApprovalPolicy) {
    const { selectedTeam } = useAppStore.getState();
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team defaults.");
      return;
    }
    const saved = saveTeamRoomDefaults(selectedTeam, { ...loadTeamRoomDefaults(selectedTeam), approvalPolicy });
    applySavedDefaults(saved);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      `New rooms in this team will default to ${approvalPolicyLabels[saved.approvalPolicy]}.`
    );
  }

  function updateTeamDefaultCodexModel(codexModel: string) {
    const { selectedTeam } = useAppStore.getState();
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team defaults.");
      return;
    }
    const saved = saveTeamRoomDefaults(selectedTeam, { ...loadTeamRoomDefaults(selectedTeam), codexModel });
    applySavedDefaults(saved);
    setTeamHistoryMessageForTeam(
      selectedTeam,
      `New rooms in this team will default to ${formatCodexModel(saved.codexModel)}.`
    );
  }

  function updateTeamDefaultInviteApprovalGate(inviteApprovalGate: boolean) {
    const { selectedTeam } = useAppStore.getState();
    if (!selectedTeam) {
      setSelectedTeamHistoryMessage("Create or select a team before changing team defaults.");
      return;
    }
    const saved = saveTeamRoomDefaults(selectedTeam, { ...loadTeamRoomDefaults(selectedTeam), inviteApprovalGate });
    applySavedDefaults(saved);
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
