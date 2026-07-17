import { normalizeSafeBranchName } from "./gitApprovalPlan";

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

const githubOwnerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const githubRepoPattern = /^[A-Za-z0-9._-]{1,100}$/;

export function normalizeGitHubRepoRef(owner: string, repo: string): GitHubRepoRef {
  const normalizedOwner = owner.trim();
  const normalizedRepo = repo.trim();
  if (!githubOwnerPattern.test(normalizedOwner)) {
    throw new Error("GitHub owner must be a valid user or organization name.");
  }
  if (!githubRepoPattern.test(normalizedRepo) || normalizedRepo === "." || normalizedRepo === "..") {
    throw new Error("GitHub repo must be a valid repository name.");
  }
  return {
    owner: normalizedOwner,
    repo: normalizedRepo
  };
}

export function normalizeGitHubBranchName(branch: string): string {
  return normalizeSafeBranchName(branch, {
    required: "GitHub branch is required.",
    unsafe: (original) => `Unsafe GitHub branch name: ${original}`
  });
}
