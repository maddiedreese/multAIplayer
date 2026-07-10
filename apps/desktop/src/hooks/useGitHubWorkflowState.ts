import { useMemo } from "react";
import type { GitHubActionRun, GitHubAuthConfig, SignedInUser } from "../lib/authClient";
import { checkGitHubActionsReadiness, checkGitHubWorkflowReadiness } from "../lib/githubWorkflowReadiness";
import { summarizeActionRuns } from "../lib/githubActionsSummary";
import { buildGitWorkflowApprovalPreview, type GitWorkflowDraft } from "../lib/gitWorkflowDraft";

interface UseGitHubWorkflowStateOptions {
  actionRuns: GitHubActionRun[];
  authConfig: GitHubAuthConfig | null;
  currentUser: SignedInUser | null;
  gitWorkflowDraft: GitWorkflowDraft;
  projectPath: string;
}

export function useGitHubWorkflowState({
  actionRuns,
  authConfig,
  currentUser,
  gitWorkflowDraft,
  projectPath
}: UseGitHubWorkflowStateOptions) {
  const actionsSummary = useMemo(() => summarizeActionRuns(actionRuns), [actionRuns]);
  const githubWorkflowReadiness = useMemo(
    () =>
      checkGitHubWorkflowReadiness({
        pushEnabled: gitWorkflowDraft.pushEnabled,
        authConfig,
        currentUser,
        owner: gitWorkflowDraft.prOwner,
        repo: gitWorkflowDraft.prRepo,
        head: gitWorkflowDraft.branchName,
        base: gitWorkflowDraft.prBase
      }),
    [
      authConfig,
      currentUser,
      gitWorkflowDraft.branchName,
      gitWorkflowDraft.prBase,
      gitWorkflowDraft.prOwner,
      gitWorkflowDraft.prRepo,
      gitWorkflowDraft.pushEnabled
    ]
  );
  const githubActionsReadiness = useMemo(
    () =>
      checkGitHubActionsReadiness({
        authConfig,
        currentUser,
        owner: gitWorkflowDraft.prOwner,
        repo: gitWorkflowDraft.prRepo,
        branch: gitWorkflowDraft.branchName
      }),
    [authConfig, currentUser, gitWorkflowDraft.branchName, gitWorkflowDraft.prOwner, gitWorkflowDraft.prRepo]
  );
  const gitApprovalPreview = useMemo(
    () => buildGitWorkflowApprovalPreview(projectPath, gitWorkflowDraft),
    [gitWorkflowDraft, projectPath]
  );

  return {
    actionsSummary,
    githubWorkflowReadiness,
    githubActionsReadiness,
    gitApprovalPreview
  };
}
