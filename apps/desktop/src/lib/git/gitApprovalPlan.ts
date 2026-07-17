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

export interface GitWorkflowApprovalPreview {
  title: string;
  detail: string;
  commands: string[];
}

export const maxGitBranchNameChars = 200;
export const maxCommitMessageChars = 500;

export interface SafeBranchNameMessages {
  required: string;
  unsafe: (original: string) => string;
}

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
  const approvals = [createBranchApproval(cwd, safeBranch), createCommitApproval(cwd, normalizedMessage)];
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

export function formatGitWorkflowApprovalPreview(plan: GitWorkflowApprovalPlan): GitWorkflowApprovalPreview[] {
  return plan.approvals.map((approval) => ({
    title: approval.summary,
    detail:
      approval.action === "pull_request"
        ? "Uses the signed-in GitHub session to open a draft pull request after push succeeds."
        : `Runs in ${approval.cwd}`,
    commands: [...approval.commands]
  }));
}

export function assertSafeBranchName(branch: string): string {
  return normalizeSafeBranchName(branch, {
    required: "Branch name is required",
    unsafe: (original) => `Unsafe branch name: ${original}`
  });
}

/** Shared Git ref validation for local Git and GitHub workflow boundaries. */
export function normalizeSafeBranchName(branch: string, messages: SafeBranchNameMessages): string {
  const normalized = branch.trim();
  if (!normalized) throw new Error(messages.required);
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
    throw new Error(messages.unsafe(branch));
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
  // Display-only preview text. Never pass this string to a shell or command executor;
  // execution must continue to use validated arguments as a structured argv array.
  return `'${value.replace(/'/g, "'\\''")}'`;
}
