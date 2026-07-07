import { useAppStore } from "../store/appStore";

export function useGitHubWorkflowPanelState() {
  const gitStatusByRoom = useAppStore((state) => state.gitStatusByRoom);
  const setGitStatusByRoom = useAppStore((state) => state.setGitStatusByRoom);
  const gitWorkflowBusyByRoom = useAppStore((state) => state.gitWorkflowBusyByRoom);
  const setGitWorkflowBusyByRoom = useAppStore((state) => state.setGitWorkflowBusyByRoom);
  const gitWorkflowMessagesByRoom = useAppStore((state) => state.gitWorkflowMessagesByRoom);
  const setGitWorkflowMessagesByRoom = useAppStore((state) => state.setGitWorkflowMessagesByRoom);
  const gitWorkflowDraftsByRoom = useAppStore((state) => state.gitWorkflowDraftsByRoom);
  const setGitWorkflowDraftsByRoom = useAppStore((state) => state.setGitWorkflowDraftsByRoom);
  const actionsBusyByRoom = useAppStore((state) => state.actionsBusyByRoom);
  const setActionsBusyByRoom = useAppStore((state) => state.setActionsBusyByRoom);
  const actionsMessagesByRoom = useAppStore((state) => state.actionsMessagesByRoom);
  const setActionsMessagesByRoom = useAppStore((state) => state.setActionsMessagesByRoom);
  const actionRunsByRoom = useAppStore((state) => state.actionRunsByRoom);
  const setActionRunsByRoom = useAppStore((state) => state.setActionRunsByRoom);
  const actionsLastCheckedByRoom = useAppStore((state) => state.actionsLastCheckedByRoom);
  const setActionsLastCheckedByRoom = useAppStore((state) => state.setActionsLastCheckedByRoom);

  return {
    gitStatusByRoom,
    setGitStatusByRoom,
    gitWorkflowBusyByRoom,
    setGitWorkflowBusyByRoom,
    gitWorkflowMessagesByRoom,
    setGitWorkflowMessagesByRoom,
    actionsBusyByRoom,
    setActionsBusyByRoom,
    actionsMessagesByRoom,
    setActionsMessagesByRoom,
    actionRunsByRoom,
    setActionRunsByRoom,
    actionsLastCheckedByRoom,
    setActionsLastCheckedByRoom,
    gitWorkflowDraftsByRoom,
    setGitWorkflowDraftsByRoom
  };
}
