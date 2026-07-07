import { useState } from "react";
import type { ApprovalPolicy } from "@multaiplayer/protocol";
import type { LocalHistorySettings } from "../lib/localHistory";
import { loadTeamRoomDefaults } from "../lib/teamRoomDefaults";
import { useAppStore } from "../store/appStore";

export function useHistoryDefaultsState({ initialTeamId }: { initialTeamId: string }) {
  const [historySettings, setHistorySettings] = useState<LocalHistorySettings>({
    enabled: true,
    retentionDays: 30
  });
  const [teamHistorySettings, setTeamHistorySettings] = useState<LocalHistorySettings>({
    enabled: true,
    retentionDays: 30
  });
  const [teamDefaultApprovalPolicy, setTeamDefaultApprovalPolicy] = useState<ApprovalPolicy>(() =>
    loadTeamRoomDefaults(initialTeamId).approvalPolicy
  );
  const [teamDefaultCodexModel, setTeamDefaultCodexModel] = useState(() =>
    loadTeamRoomDefaults(initialTeamId).codexModel
  );
  const [teamDefaultBrowserProfilePersistent, setTeamDefaultBrowserProfilePersistent] = useState(() =>
    loadTeamRoomDefaults(initialTeamId).browserProfilePersistent
  );
  const [teamDefaultInviteApprovalGate, setTeamDefaultInviteApprovalGate] = useState(() =>
    loadTeamRoomDefaults(initialTeamId).inviteApprovalGate
  );
  const historyMessagesByRoom = useAppStore((state) => state.historyMessagesByRoom);
  const setHistoryMessagesByRoom = useAppStore((state) => state.setHistoryMessagesByRoom);
  const teamHistoryMessagesByTeam = useAppStore((state) => state.teamHistoryMessagesByTeam);
  const setTeamHistoryMessagesByTeam = useAppStore((state) => state.setTeamHistoryMessagesByTeam);

  return {
    historySettings,
    setHistorySettings,
    teamHistorySettings,
    setTeamHistorySettings,
    teamDefaultApprovalPolicy,
    setTeamDefaultApprovalPolicy,
    teamDefaultCodexModel,
    setTeamDefaultCodexModel,
    teamDefaultBrowserProfilePersistent,
    setTeamDefaultBrowserProfilePersistent,
    teamDefaultInviteApprovalGate,
    setTeamDefaultInviteApprovalGate,
    historyMessagesByRoom,
    setHistoryMessagesByRoom,
    teamHistoryMessagesByTeam,
    setTeamHistoryMessagesByTeam
  };
}
