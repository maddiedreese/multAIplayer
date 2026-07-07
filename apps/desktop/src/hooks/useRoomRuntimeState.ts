import { useState } from "react";
import { useAppStore } from "../store/appStore";

export function useRoomRuntimeState() {
  const inspectorTabsByRoom = useAppStore((state) => state.inspectorTabsByRoom);
  const setInspectorTabsByRoom = useAppStore((state) => state.setInspectorTabsByRoom);
  const [forgottenRoomIds, setForgottenRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedRoomIds, setRevokedRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedTeamIds, setRevokedTeamIds] = useState<Set<string>>(() => new Set());
  const presenceByRoom = useAppStore((state) => state.presenceByRoom);
  const setPresenceByRoom = useAppStore((state) => state.setPresenceByRoom);
  const clearPresenceByRoom = useAppStore((state) => state.clearPresenceByRoom);
  const setRoomPresenceForDevice = useAppStore((state) => state.setRoomPresenceForDevice);
  const hostHandoffsByRoom = useAppStore((state) => state.hostHandoffsByRoom);
  const setHostHandoffsByRoom = useAppStore((state) => state.setHostHandoffsByRoom);
  const codexContinuationByRoom = useAppStore((state) => state.codexContinuationByRoom);
  const setCodexContinuationByRoom = useAppStore((state) => state.setCodexContinuationByRoom);
  const gitWorkflowEventsByRoom = useAppStore((state) => state.gitWorkflowEventsByRoom);
  const setGitWorkflowEventsByRoom = useAppStore((state) => state.setGitWorkflowEventsByRoom);
  const githubActionsEventsByRoom = useAppStore((state) => state.githubActionsEventsByRoom);
  const setGitHubActionsEventsByRoom = useAppStore((state) => state.setGitHubActionsEventsByRoom);

  return {
    inspectorTabsByRoom,
    setInspectorTabsByRoom,
    forgottenRoomIds,
    setForgottenRoomIds,
    revokedRoomIds,
    setRevokedRoomIds,
    revokedTeamIds,
    setRevokedTeamIds,
    presenceByRoom,
    setPresenceByRoom,
    clearPresenceByRoom,
    setRoomPresenceForDevice,
    hostHandoffsByRoom,
    setHostHandoffsByRoom,
    codexContinuationByRoom,
    setCodexContinuationByRoom,
    gitWorkflowEventsByRoom,
    setGitWorkflowEventsByRoom,
    githubActionsEventsByRoom,
    setGitHubActionsEventsByRoom
  };
}
