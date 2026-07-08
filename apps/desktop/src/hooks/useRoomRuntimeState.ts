import { useCallback, useMemo, useState } from "react";
import { useAppStore } from "../store/appStore";
import { projectCodexHostHandoffMaps } from "../store/slices/codexHostHandoffSlice";
import {
  projectInspectorTabsByRoom,
  projectPresenceByRoom
} from "../store/slices/historyPresenceSlice";
import {
  projectGitHubActionsEventsByRoom,
  projectGitWorkflowEventsByRoom
} from "../store/slices/gitWorkflowSlice";

export function useRoomRuntimeState() {
  const historyPresenceByRoom = useAppStore((state) => state.historyPresenceByRoom);
  const [forgottenRoomIds, setForgottenRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedRoomIds, setRevokedRoomIds] = useState<Set<string>>(() => new Set());
  const [revokedTeamIds, setRevokedTeamIds] = useState<Set<string>>(() => new Set());
  const rememberForgottenRoom = useCallback((roomId: string) => {
    setForgottenRoomIds((current) => new Set(current).add(roomId));
  }, []);
  const restoreForgottenRoom = useCallback((roomId: string) => {
    setForgottenRoomIds((current) => {
      const next = new Set(current);
      next.delete(roomId);
      return next;
    });
  }, []);
  const revokeRoomAccess = useCallback((roomId: string) => {
    setRevokedRoomIds((current) => new Set(current).add(roomId));
  }, []);
  const restoreRoomAccess = useCallback((roomId: string) => {
    setRevokedRoomIds((current) => {
      const next = new Set(current);
      next.delete(roomId);
      return next;
    });
  }, []);
  const revokeTeamAccess = useCallback((teamId: string) => {
    setRevokedTeamIds((current) => new Set(current).add(teamId));
  }, []);
  const restoreTeamAccess = useCallback((teamId: string) => {
    setRevokedTeamIds((current) => {
      const next = new Set(current);
      next.delete(teamId);
      return next;
    });
  }, []);
  const restoreWorkspaceAccess = useCallback((teamId: string, roomId: string) => {
    restoreRoomAccess(roomId);
    restoreTeamAccess(teamId);
  }, [restoreRoomAccess, restoreTeamAccess]);
  const revokeWorkspaceAccess = useCallback((teamId: string, roomId: string) => {
    revokeRoomAccess(roomId);
    revokeTeamAccess(teamId);
    rememberForgottenRoom(roomId);
  }, [rememberForgottenRoom, revokeRoomAccess, revokeTeamAccess]);
  const clearPresenceByRoom = useAppStore((state) => state.clearPresenceByRoom);
  const setRoomPresenceForDevice = useAppStore((state) => state.setRoomPresenceForDevice);
  const codexRuntimeByRoom = useAppStore((state) => state.codexRuntimeByRoom);
  const gitWorkflowRuntimeByRoom = useAppStore((state) => state.gitWorkflowRuntimeByRoom);
  const historyPresenceMaps = useMemo(() => ({
    inspectorTabsByRoom: projectInspectorTabsByRoom(historyPresenceByRoom),
    presenceByRoom: projectPresenceByRoom(historyPresenceByRoom)
  }), [historyPresenceByRoom]);
  const codexRuntimeMaps = useMemo(() => projectCodexHostHandoffMaps(codexRuntimeByRoom), [codexRuntimeByRoom]);
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
    rememberForgottenRoom,
    restoreForgottenRoom,
    revokedRoomIds,
    revokeRoomAccess,
    restoreRoomAccess,
    revokedTeamIds,
    revokeTeamAccess,
    restoreTeamAccess,
    revokeWorkspaceAccess,
    restoreWorkspaceAccess,
    presenceByRoom: historyPresenceMaps.presenceByRoom,
    clearPresenceByRoom,
    setRoomPresenceForDevice,
    hostHandoffsByRoom: codexRuntimeMaps.hostHandoffsByRoom,
    codexContinuationByRoom: codexRuntimeMaps.codexContinuationByRoom,
    gitWorkflowEventsByRoom,
    githubActionsEventsByRoom
  };
}
