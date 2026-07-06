import { useState } from "react";
import type { GitHubActionRun } from "../lib/authClient";
import type { GitStatusSummary } from "../lib/localBackend";
import type { GitWorkflowDraft } from "../lib/gitWorkflowDraft";

export function useGitHubWorkflowPanelState() {
  const [gitStatusByRoom, setGitStatusByRoom] = useState<Record<string, GitStatusSummary | null>>({});
  const [gitWorkflowBusyByRoom, setGitWorkflowBusyByRoom] = useState<Record<string, boolean>>({});
  const [gitWorkflowMessagesByRoom, setGitWorkflowMessagesByRoom] = useState<Record<string, string | null>>({});
  const [actionsBusyByRoom, setActionsBusyByRoom] = useState<Record<string, boolean>>({});
  const [actionsMessagesByRoom, setActionsMessagesByRoom] = useState<Record<string, string | null>>({});
  const [actionRunsByRoom, setActionRunsByRoom] = useState<Record<string, GitHubActionRun[]>>({});
  const [actionsLastCheckedByRoom, setActionsLastCheckedByRoom] = useState<Record<string, string | null>>({});
  const [gitWorkflowDraftsByRoom, setGitWorkflowDraftsByRoom] = useState<Record<string, Partial<GitWorkflowDraft>>>({});

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
