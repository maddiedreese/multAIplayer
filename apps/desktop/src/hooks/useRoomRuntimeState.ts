import { useState } from "react";
import { useAppStore } from "../store/appStore";

export function useRoomRuntimeState() {
  const inspectorTabsByRoom = useAppStore((state) => state.inspectorTabsByRoom);
  const [forgottenRoomIds, setForgottenRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedRoomIds, setRevokedRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedTeamIds, setRevokedTeamIds] = useState<Set<string>>(() => new Set());
  const presenceByRoom = useAppStore((state) => state.presenceByRoom);
  const clearPresenceByRoom = useAppStore((state) => state.clearPresenceByRoom);
  const setRoomPresenceForDevice = useAppStore((state) => state.setRoomPresenceForDevice);
  const hostHandoffsByRoom = useAppStore((state) => state.hostHandoffsByRoom);
  const codexContinuationByRoom = useAppStore((state) => state.codexContinuationByRoom);
  const gitWorkflowEventsByRoom = useAppStore((state) => state.gitWorkflowEventsByRoom);
  const githubActionsEventsByRoom = useAppStore((state) => state.githubActionsEventsByRoom);

  return {
    inspectorTabsByRoom,
    forgottenRoomIds,
    setForgottenRoomIds,
    revokedRoomIds,
    setRevokedRoomIds,
    revokedTeamIds,
    setRevokedTeamIds,
    presenceByRoom,
    clearPresenceByRoom,
    setRoomPresenceForDevice,
    hostHandoffsByRoom,
    codexContinuationByRoom,
    gitWorkflowEventsByRoom,
    githubActionsEventsByRoom
  };
}
