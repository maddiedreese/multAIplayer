import type {
  CodexEventPlaintextPayload,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  TerminalResultPlaintextPayload
} from "@multaiplayer/protocol";

export function buildTerminalResultLines(result: TerminalResultPlaintextPayload): string[] {
  const output = [result.stdout.trim(), result.stderr.trim(), result.error?.trim()].filter(Boolean).join("\n");
  return [
    `${result.ranBy} ran approved terminal request: ${result.command}`,
    output || `Command exited with ${result.exitStatus ?? "unknown"} and no output.`
  ];
}

export function buildGitWorkflowEventLines(event: GitWorkflowEventPlaintextPayload): string[] {
  const header = `${event.runner} ${formatGitWorkflowStatus(event.status)}: ${event.message}`;
  const commandLines = (event.results ?? [])
    .flatMap((result) => [`$ ${result.command}`, result.stdout.trim(), result.stderr.trim()])
    .filter(Boolean);
  return [header, ...commandLines];
}

export function buildGitHubActionsEventLines(event: GitHubActionsEventPlaintextPayload): string[] {
  const runSummary = event.runs.slice(0, 4).map((run) => {
    const status = run.conclusion ? `${run.status}/${run.conclusion}` : run.status;
    return `- ${run.displayTitle ?? run.name}: ${status}`;
  });
  return [
    `${event.checkedBy} refreshed GitHub Actions for ${event.owner}/${event.repo}@${event.branch}: ${event.summary.label}`,
    event.summary.detail,
    ...runSummary
  ];
}

export function buildCodexEventLine(event: CodexEventPlaintextPayload): string {
  const thread = event.threadId ? ` · ${event.threadId}` : "";
  return `Codex ${formatCodexEventStatus(event.status)} by ${event.host}${thread}: ${event.message}`;
}

export function formatCodexEventStatus(status: CodexEventPlaintextPayload["status"]): string {
  switch (status) {
    case "started":
      return "started";
    case "event":
      return "event";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

function formatGitWorkflowStatus(status: GitWorkflowEventPlaintextPayload["status"]): string {
  switch (status) {
    case "started":
      return "started Git workflow";
    case "completed":
      return "completed Git workflow";
    case "failed":
      return "reported Git workflow failure";
    case "pr_opened":
      return "opened a draft PR";
  }
}
