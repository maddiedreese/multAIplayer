import { useState } from "react";
import type { GitHubActionRun } from "../lib/authClient";
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
  const [actionsBusyByRoom, setActionsBusyByRoom] = useState<Record<string, boolean>>({});
  const [actionsMessagesByRoom, setActionsMessagesByRoom] = useState<Record<string, string | null>>({});
  const [actionRunsByRoom, setActionRunsByRoom] = useState<Record<string, GitHubActionRun[]>>({});
  const [actionsLastCheckedByRoom, setActionsLastCheckedByRoom] = useState<Record<string, string | null>>({});

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
