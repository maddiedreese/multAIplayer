import { useMemo } from "react";
import { useAppStore } from "../store/appStore";

export function useGitHubWorkflowPanelState() {
  const gitStatusByRoom = useAppStore((state) => state.gitStatusByRoom);
  const gitWorkflowBusyByRoom = useAppStore((state) => state.gitWorkflowBusyByRoom);
  const gitWorkflowMessagesByRoom = useAppStore((state) => state.gitWorkflowMessagesByRoom);
  const gitWorkflowDraftsByRoom = useAppStore((state) => state.gitWorkflowDraftsByRoom);
  const githubActionsByRoom = useAppStore((state) => state.githubActionsByRoom);

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
