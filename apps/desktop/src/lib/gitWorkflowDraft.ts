export interface GitWorkflowDraft {
  branchName: string;
  commitMessage: string;
  pushEnabled: boolean;
  prOwner: string;
  prRepo: string;
  prBase: string;
}

export const defaultGitWorkflowDraft: GitWorkflowDraft = {
  branchName: "multaiplayer/alpha-codex-room",
  commitMessage: "Build multAIplayer alpha room workflow",
  pushEnabled: false,
  prOwner: "maddiedreese",
  prRepo: "multAIplayer",
  prBase: "main"
};

export function resolveGitWorkflowDraft(
  draftsByRoom: Record<string, Partial<GitWorkflowDraft>>,
  roomId: string
): GitWorkflowDraft {
  return {
    ...defaultGitWorkflowDraft,
    ...(draftsByRoom[roomId] ?? {})
  };
}

export function updateGitWorkflowDraftRecord(
  draftsByRoom: Record<string, Partial<GitWorkflowDraft>>,
  roomId: string,
  patch: Partial<GitWorkflowDraft>
): Record<string, Partial<GitWorkflowDraft>> {
  return {
    ...draftsByRoom,
    [roomId]: {
      ...resolveGitWorkflowDraft(draftsByRoom, roomId),
      ...patch
    }
  };
}
