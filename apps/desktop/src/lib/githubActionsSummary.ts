import type { GitHubActionRun } from "./authClient";
import type { ActionsSummaryDisplay } from "../components/GitHubActionsPanel";

export function summarizeActionRuns(runs: GitHubActionRun[]): ActionsSummaryDisplay {
  if (runs.length === 0) {
    return {
      label: "Unknown",
      detail: "No workflow runs loaded for this branch.",
      tone: "muted"
    };
  }

  const failed = runs.filter((run) =>
    ["failure", "timed_out", "cancelled", "action_required"].includes(run.conclusion ?? "")
  );
  if (failed.length > 0) {
    return {
      label: "Failing",
      detail: `${failed.length} workflow run${failed.length === 1 ? "" : "s"} need attention.`,
      tone: "red"
    };
  }

  const running = runs.filter((run) =>
    ["queued", "in_progress", "requested", "waiting", "pending"].includes(run.status)
  );
  if (running.length > 0) {
    return {
      label: "Running",
      detail: `${running.length} workflow run${running.length === 1 ? "" : "s"} still in progress.`,
      tone: "yellow"
    };
  }

  if (runs.every((run) => run.conclusion === "success")) {
    return {
      label: "Passing",
      detail: "Latest loaded workflow runs are passing.",
      tone: "green"
    };
  }

  return {
    label: "Review",
    detail: "Workflow runs loaded with mixed or neutral conclusions.",
    tone: "yellow"
  };
}
