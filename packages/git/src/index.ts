export interface GitActionApproval {
  cwd: string;
  action: "branch" | "commit" | "push" | "pull_request";
  summary: string;
  commands: string[];
}

export interface GitWorkflowApprovalPlan {
  cwd: string;
  branch: string;
  message: string;
  push: boolean;
  approvals: GitActionApproval[];
}

export interface GitStatusFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
}

export interface GitStatusSummary {
  branch: string;
  files: GitStatusFile[];
}

export const maxGitBranchNameChars = 200;
export const maxCommitMessageChars = 500;

export function createBranchApproval(cwd: string, branch: string): GitActionApproval {
  assertSafeBranchName(branch);
  return {
    cwd,
    action: "branch",
    summary: `Create branch ${branch}`,
    commands: [`git switch -c ${quoteGitArg(branch)}`]
  };
}

export function createCommitApproval(cwd: string, message: string): GitActionApproval {
  const normalizedMessage = normalizeCommitMessage(message);
  return {
    cwd,
    action: "commit",
    summary: `Commit staged room changes`,
    commands: ["git add -A", `git commit -m ${quoteGitArg(normalizedMessage)}`]
  };
}

export function createPushApproval(cwd: string, branch: string): GitActionApproval {
  assertSafeBranchName(branch);
  return {
    cwd,
    action: "push",
    summary: `Push branch ${branch}`,
    commands: [`git push -u origin ${quoteGitArg(branch)}`]
  };
}

export function createPullRequestApproval(cwd: string, branch: string): GitActionApproval {
  assertSafeBranchName(branch);
  return {
    cwd,
    action: "pull_request",
    summary: `Open draft pull request from ${branch}`,
    commands: [`gh pr create --draft --head ${quoteGitArg(branch)}`]
  };
}

export function createGitWorkflowApprovalPlan(
  cwd: string,
  branch: string,
  message: string,
  push: boolean
): GitWorkflowApprovalPlan {
  const safeBranch = assertSafeBranchName(branch);
  const normalizedMessage = normalizeCommitMessage(message);
  const approvals = [
    createBranchApproval(cwd, safeBranch),
    createCommitApproval(cwd, normalizedMessage)
  ];
  if (push) {
    approvals.push(createPushApproval(cwd, safeBranch));
    approvals.push(createPullRequestApproval(cwd, safeBranch));
  }
  return {
    cwd,
    branch: safeBranch,
    message: normalizedMessage,
    push,
    approvals
  };
}

export function assertSafeBranchName(branch: string): string {
  const normalized = branch.trim();
  if (!normalized) throw new Error("Branch name is required");
  if (
    normalized.length > maxGitBranchNameChars ||
    normalized.startsWith("-") ||
    normalized === "@" ||
    normalized.includes("..") ||
    /\s/.test(normalized) ||
    normalized.includes("~") ||
    normalized.includes("^") ||
    normalized.includes(":") ||
    normalized.includes("?") ||
    normalized.includes("*") ||
    normalized.includes("[") ||
    normalized.includes("\\") ||
    normalized.includes("//") ||
    normalized.endsWith("/") ||
    normalized.endsWith(".") ||
    normalized.includes("@{") ||
    normalized.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
  ) {
    throw new Error(`Unsafe branch name: ${branch}`);
  }
  return normalized;
}

export function normalizeCommitMessage(message: string): string {
  const normalized = message.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("Commit message is required");
  if (normalized.length > maxCommitMessageChars) {
    throw new Error(`Commit message must be ${maxCommitMessageChars} characters or fewer`);
  }
  return normalized;
}

function quoteGitArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
