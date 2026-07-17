import { createGitWorkflowApprovalPlan, formatGitWorkflowApprovalPreview } from "./gitApprovalPlan";
import { normalizeGitHubBranchName } from "./githubValidation";
import { reportExpectedFailure } from "../core/nonFatalReporting";

export interface GitWorkflowDraft {
  branchName: string;
  commitMessage: string;
  pushEnabled: boolean;
  prOwner: string;
  prRepo: string;
  prBase: string;
}

export const defaultGitWorkflowDraft: GitWorkflowDraft = {
  branchName: "",
  commitMessage: "",
  pushEnabled: false,
  prOwner: "",
  prRepo: "",
  prBase: "main"
};

export interface GitRemoteRepoRef {
  owner: string;
  repo: string;
}

export function isGitWorkflowInFlight(busyByRoom: Record<string, boolean>, roomId: string): boolean {
  return busyByRoom[roomId] === true;
}

export function gitWorkflowInFlightMessage(): string {
  return "A git workflow is already running in this room.";
}

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

export function buildGitWorkflowApprovalPreview(projectPath: string, draft: GitWorkflowDraft) {
  try {
    const plan = createGitWorkflowApprovalPlan(projectPath, draft.branchName, draft.commitMessage, draft.pushEnabled);
    const normalizedBase = draft.pushEnabled
      ? normalizeGitHubBranchName(draft.prBase.trim() || "main")
      : draft.prBase.trim();
    return {
      plan,
      normalizedBase,
      steps: formatGitWorkflowApprovalPreview(plan),
      error: null
    };
  } catch (error) {
    return {
      plan: null,
      normalizedBase: draft.prBase.trim(),
      steps: [],
      error: String(error)
    };
  }
}

export function parseGitHubRemoteUrl(remoteUrl: string): GitRemoteRepoRef | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (sshMatch) return normalizeRemoteRef(sshMatch[1], sshMatch[2]);

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo, ...rest] = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (rest.length > 0) return null;
    return normalizeRemoteRef(owner, repo?.replace(/\.git$/i, ""));
  } catch {
    reportExpectedFailure("GitHub remote URL validation rejected malformed input");
    return null;
  }
}

function normalizeRemoteRef(owner: string | undefined, repo: string | undefined): GitRemoteRepoRef | null {
  const normalizedOwner = owner?.trim() ?? "";
  const normalizedRepo = repo?.trim().replace(/\.git$/i, "") ?? "";
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(normalizedOwner)) return null;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(normalizedRepo) || normalizedRepo === "." || normalizedRepo === "..") return null;
  return {
    owner: normalizedOwner,
    repo: normalizedRepo
  };
}
