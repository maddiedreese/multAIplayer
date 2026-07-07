import { useAppStore } from "../store/appStore";

export function useGitHubWorkflowPanelState() {
  const gitStatusByRoom = useAppStore((state) => state.gitStatusByRoom);
  const gitWorkflowBusyByRoom = useAppStore((state) => state.gitWorkflowBusyByRoom);
  const gitWorkflowMessagesByRoom = useAppStore((state) => state.gitWorkflowMessagesByRoom);
  const gitWorkflowDraftsByRoom = useAppStore((state) => state.gitWorkflowDraftsByRoom);
  const actionsBusyByRoom = useAppStore((state) => state.actionsBusyByRoom);
  const actionsMessagesByRoom = useAppStore((state) => state.actionsMessagesByRoom);
  const actionRunsByRoom = useAppStore((state) => state.actionRunsByRoom);
  const actionsLastCheckedByRoom = useAppStore((state) => state.actionsLastCheckedByRoom);

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
