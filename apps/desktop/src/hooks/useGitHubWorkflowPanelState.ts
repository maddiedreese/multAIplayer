import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { projectGitHubWorkflowPanelMaps } from "../store/slices/gitWorkflowSlice";

export function useGitHubWorkflowPanelState() {
  const gitWorkflowRuntimeByRoom = useAppStore((state) => state.gitWorkflowRuntimeByRoom);
  const {
    gitStatusByRoom,
    gitWorkflowBusyByRoom,
    gitWorkflowMessagesByRoom,
    gitWorkflowDraftsByRoom,
    actionsBusyByRoom,
    actionsMessagesByRoom,
    actionRunsByRoom,
    actionsLastCheckedByRoom
  } = useMemo(
    () => projectGitHubWorkflowPanelMaps(gitWorkflowRuntimeByRoom),
    [gitWorkflowRuntimeByRoom]
  );

  return {
    gitStatusByRoom,
    gitWorkflowBusyByRoom,
    gitWorkflowMessagesByRoom,
    actionsBusyByRoom,
    actionsMessagesByRoom,
    actionRunsByRoom,
    actionsLastCheckedByRoom,
    gitWorkflowDraftsByRoom
  };
}
