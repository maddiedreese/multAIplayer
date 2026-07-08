import { useCallback, useMemo, useState } from "react";
import type { ApprovalPolicy } from "@multaiplayer/protocol";
import type { LocalHistorySettings } from "../lib/localHistory";
import { loadTeamRoomDefaults } from "../lib/teamRoomDefaults";
import { useAppStore } from "../store/appStore";
import {
  projectHistoryMessagesByRoom,
  projectTeamHistoryMessagesByTeam
} from "../store/slices/historyPresenceSlice";

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
  const historyPresenceByRoom = useAppStore((state) => state.historyPresenceByRoom);
  const teamHistoryByTeam = useAppStore((state) => state.teamHistoryByTeam);
  const historyMessagesByRoom = useMemo(
    () => projectHistoryMessagesByRoom(historyPresenceByRoom),
    [historyPresenceByRoom]
  );
  const teamHistoryMessagesByTeam = useMemo(
    () => projectTeamHistoryMessagesByTeam(teamHistoryByTeam),
    [teamHistoryByTeam]
  );
  const replaceHistorySettings = useCallback((next: LocalHistorySettings) => {
    setHistorySettings(next);
  }, []);
  const replaceTeamHistorySettings = useCallback((next: LocalHistorySettings) => {
    setTeamHistorySettings(next);
  }, []);
  const replaceTeamDefaultApprovalPolicy = useCallback((next: ApprovalPolicy) => {
    setTeamDefaultApprovalPolicy(next);
  }, []);
  const replaceTeamDefaultCodexModel = useCallback((next: string) => {
    setTeamDefaultCodexModel(next);
  }, []);
  const replaceTeamDefaultBrowserProfilePersistent = useCallback((next: boolean) => {
    setTeamDefaultBrowserProfilePersistent(next);
  }, []);
  const replaceTeamDefaultInviteApprovalGate = useCallback((next: boolean) => {
    setTeamDefaultInviteApprovalGate(next);
  }, []);

  return {
    historySettings,
    replaceHistorySettings,
    teamHistorySettings,
    replaceTeamHistorySettings,
    setTeamHistorySettings,
    teamDefaultApprovalPolicy,
    replaceTeamDefaultApprovalPolicy,
    setTeamDefaultApprovalPolicy,
    teamDefaultCodexModel,
    replaceTeamDefaultCodexModel,
    setTeamDefaultCodexModel,
    teamDefaultBrowserProfilePersistent,
    replaceTeamDefaultBrowserProfilePersistent,
    setTeamDefaultBrowserProfilePersistent,
    teamDefaultInviteApprovalGate,
    replaceTeamDefaultInviteApprovalGate,
    setTeamDefaultInviteApprovalGate,
    historyMessagesByRoom,
    teamHistoryMessagesByTeam
  };
}
