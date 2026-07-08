import { useMemo, useState } from "react";
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
  const gitWorkflowByRoom = useAppStore((state) => state.gitWorkflowByRoom);
  const githubActionsEventsByRoom = useAppStore((state) => state.githubActionsEventsByRoom);
  const gitWorkflowEventsByRoom = useMemo(() => Object.fromEntries(
    Object.entries(gitWorkflowByRoom)
      .filter(([, workflow]) => workflow.events)
      .map(([roomId, workflow]) => [roomId, workflow.events ?? []])
  ), [gitWorkflowByRoom]);

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
