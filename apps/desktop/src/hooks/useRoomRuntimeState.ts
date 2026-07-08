import { useMemo, useState } from "react";
import { useAppStore } from "../store/appStore";
import {
  projectInspectorTabsByRoom,
  projectPresenceByRoom
} from "../store/slices/historyPresenceSlice";
import {
  projectGitHubActionsEventsByRoom,
  projectGitWorkflowEventsByRoom
} from "../store/slices/gitWorkflowSlice";
import type { HostHandoffRecord } from "../types";

function projectCodexRuntimeMaps(codexRuntimeByRoom: ReturnType<typeof useAppStore.getState>["codexRuntimeByRoom"]) {
  const hostHandoffsByRoom: Record<string, HostHandoffRecord[]> = {};
  const codexContinuationByRoom: Record<string, HostHandoffRecord> = {};

  Object.entries(codexRuntimeByRoom).forEach(([roomId, runtime]) => {
    if (runtime.hostHandoffs) hostHandoffsByRoom[roomId] = runtime.hostHandoffs;
    if (runtime.continuation) codexContinuationByRoom[roomId] = runtime.continuation;
  });

  return {
    hostHandoffsByRoom,
    codexContinuationByRoom
  };
}

export function useRoomRuntimeState() {
  const historyPresenceByRoom = useAppStore((state) => state.historyPresenceByRoom);
  const [forgottenRoomIds, setForgottenRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedRoomIds, setRevokedRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedTeamIds, setRevokedTeamIds] = useState<Set<string>>(() => new Set());
  const clearPresenceByRoom = useAppStore((state) => state.clearPresenceByRoom);
  const setRoomPresenceForDevice = useAppStore((state) => state.setRoomPresenceForDevice);
  const codexRuntimeByRoom = useAppStore((state) => state.codexRuntimeByRoom);
  const gitWorkflowRuntimeByRoom = useAppStore((state) => state.gitWorkflowRuntimeByRoom);
  const historyPresenceMaps = useMemo(() => ({
    inspectorTabsByRoom: projectInspectorTabsByRoom(historyPresenceByRoom),
    presenceByRoom: projectPresenceByRoom(historyPresenceByRoom)
  }), [historyPresenceByRoom]);
  const codexRuntimeMaps = useMemo(() => projectCodexRuntimeMaps(codexRuntimeByRoom), [codexRuntimeByRoom]);
  const gitWorkflowEventsByRoom = useMemo(
    () => projectGitWorkflowEventsByRoom(gitWorkflowRuntimeByRoom),
    [gitWorkflowRuntimeByRoom]
  );
  const githubActionsEventsByRoom = useMemo(
    () => projectGitHubActionsEventsByRoom(gitWorkflowRuntimeByRoom),
    [gitWorkflowRuntimeByRoom]
  );

  return {
    inspectorTabsByRoom: historyPresenceMaps.inspectorTabsByRoom,
    forgottenRoomIds,
    setForgottenRoomIds,
    revokedRoomIds,
    setRevokedRoomIds,
    revokedTeamIds,
    setRevokedTeamIds,
    presenceByRoom: historyPresenceMaps.presenceByRoom,
    clearPresenceByRoom,
    setRoomPresenceForDevice,
    hostHandoffsByRoom: codexRuntimeMaps.hostHandoffsByRoom,
    codexContinuationByRoom: codexRuntimeMaps.codexContinuationByRoom,
    gitWorkflowEventsByRoom,
    githubActionsEventsByRoom
  };
}
