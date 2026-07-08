import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import {
  projectGitHubActionsByRoom,
  projectGitWorkflowByRoom
} from "../store/slices/gitWorkflowSlice";

export function useGitHubWorkflowPanelState() {
  const gitWorkflowRuntimeByRoom = useAppStore((state) => state.gitWorkflowRuntimeByRoom);
  const gitWorkflowByRoom = useMemo(
    () => projectGitWorkflowByRoom(gitWorkflowRuntimeByRoom),
    [gitWorkflowRuntimeByRoom]
  );
  const githubActionsByRoom = useMemo(
    () => projectGitHubActionsByRoom(gitWorkflowRuntimeByRoom),
    [gitWorkflowRuntimeByRoom]
  );

  const {
    gitStatusByRoom,
    gitWorkflowBusyByRoom,
    gitWorkflowMessagesByRoom,
    gitWorkflowDraftsByRoom
  } = useMemo(() => ({
    gitStatusByRoom: Object.fromEntries(
      Object.entries(gitWorkflowByRoom)
        .filter(([, workflow]) => "status" in workflow)
        .map(([roomId, workflow]) => [roomId, workflow.status ?? null])
    ),
    gitWorkflowBusyByRoom: Object.fromEntries(
      Object.entries(gitWorkflowByRoom)
        .filter(([, workflow]) => workflow.busy)
        .map(([roomId]) => [roomId, true])
    ),
    gitWorkflowMessagesByRoom: Object.fromEntries(
      Object.entries(gitWorkflowByRoom)
        .filter(([, workflow]) => "message" in workflow)
        .map(([roomId, workflow]) => [roomId, workflow.message ?? null])
    ),
    gitWorkflowDraftsByRoom: Object.fromEntries(
      Object.entries(gitWorkflowByRoom)
        .filter(([, workflow]) => workflow.draft)
        .map(([roomId, workflow]) => [roomId, workflow.draft ?? {}])
    )
  }), [gitWorkflowByRoom]);

  const {
    actionsBusyByRoom,
    actionsMessagesByRoom,
    actionRunsByRoom,
    actionsLastCheckedByRoom
  } = useMemo(() => ({
    actionsBusyByRoom: Object.fromEntries(
      Object.entries(githubActionsByRoom)
        .filter(([, actions]) => actions.busy)
        .map(([roomId]) => [roomId, true])
    ),
    actionsMessagesByRoom: Object.fromEntries(
      Object.entries(githubActionsByRoom)
        .filter(([, actions]) => actions.message)
        .map(([roomId, actions]) => [roomId, actions.message ?? null])
    ),
    actionRunsByRoom: Object.fromEntries(
      Object.entries(githubActionsByRoom)
        .filter(([, actions]) => actions.runs)
        .map(([roomId, actions]) => [roomId, actions.runs ?? []])
    ),
    actionsLastCheckedByRoom: Object.fromEntries(
      Object.entries(githubActionsByRoom)
        .filter(([, actions]) => actions.lastChecked)
        .map(([roomId, actions]) => [roomId, actions.lastChecked ?? null])
    )
  }), [githubActionsByRoom]);

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
