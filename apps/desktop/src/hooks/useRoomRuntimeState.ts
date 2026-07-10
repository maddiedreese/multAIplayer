import { useMemo } from "react";
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
  const forgottenRoomIds = useAppStore((state) => state.forgottenRoomIds);
  const rememberForgottenRoom = useAppStore((state) => state.rememberForgottenRoom);
  const restoreForgottenRoom = useAppStore((state) => state.restoreForgottenRoom);
  const revokedRoomIds = useAppStore((state) => state.revokedRoomIds);
  const revokeRoomAccess = useAppStore((state) => state.revokeRoomAccess);
  const restoreRoomAccess = useAppStore((state) => state.restoreRoomAccess);
  const revokedTeamIds = useAppStore((state) => state.revokedTeamIds);
  const revokeTeamAccess = useAppStore((state) => state.revokeTeamAccess);
  const restoreTeamAccess = useAppStore((state) => state.restoreTeamAccess);
  const revokeWorkspaceAccess = useAppStore((state) => state.revokeWorkspaceAccess);
  const restoreWorkspaceAccess = useAppStore((state) => state.restoreWorkspaceAccess);
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
