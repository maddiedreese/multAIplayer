import { ExternalLink, RefreshCw } from "lucide-react";
import type { GitHubActionRun } from "../lib/authClient";
import type { GitHubActionsReadiness } from "../lib/githubWorkflowReadiness";

export interface ActionsSummaryDisplay {
  label: string;
  detail: string;
  tone: "green" | "yellow" | "red" | "dark" | "muted";
}

export function GitHubActionsPanel({
  summary,
  readiness,
  runs,
  owner,
  repo,
  branch,
  lastChecked,
  busy,
  refreshDisabled,
  currentUserSignedIn,
  message,
  formatTimestamp,
  onRefresh
}: {
  summary: ActionsSummaryDisplay;
  readiness: GitHubActionsReadiness;
  runs: GitHubActionRun[];
  owner: string;
  repo: string;
  branch: string;
  lastChecked: string | null;
  busy: boolean;
  refreshDisabled: boolean;
  currentUserSignedIn: boolean;
  message: string | null;
  formatTimestamp: (value: string) => string;
  onRefresh: () => void;
}) {
  return (
    <section className="panel actions-panel">
      <div className="panel-title">
        <span>GitHub Actions</span>
        <div className="panel-title-actions">
          <small className={`panel-state ${summary.tone === "green" ? "available" : summary.tone === "yellow" ? "attention" : ""}`}>
            {summary.label}
          </small>
          <button
            className="ghost"
            onClick={onRefresh}
            disabled={refreshDisabled}
          >
            <RefreshCw size={14} />
            {busy ? "Checking" : "Refresh"}
          </button>
        </div>
      </div>
      <div className={`actions-summary ${summary.tone}`}>
        <strong>{summary.detail}</strong>
        <span>
          {owner}/{repo} · {branch || "branch required"}
          {lastChecked ? ` · checked ${formatTimestamp(lastChecked)}` : ""}
        </span>
      </div>
      <div className={`workflow-message ${readiness.ready ? "" : "danger"}`}>
        {readiness.messages.join(" ")}
      </div>
      <div className="actions-list">
        {runs.map((run) => (
          <a href={run.url} target="_blank" rel="noreferrer" className={`action-run ${run.conclusion ?? run.status}`} key={run.id}>
            <span className={`run-dot ${run.conclusion ?? run.status}`} />
            <div>
              <strong>{run.displayTitle ?? run.name}</strong>
              <small>
                {run.name}
                {run.runNumber ? ` #${run.runNumber}` : ""} · {run.status}
                {run.conclusion ? ` / ${run.conclusion}` : ""} · {run.event ?? "event unknown"} · {formatTimestamp(run.updatedAt)}
              </small>
            </div>
            <ExternalLink size={13} />
          </a>
        ))}
        {!busy && runs.length === 0 && (
          <div className="empty-state">
            {currentUserSignedIn ? "No GitHub Actions runs loaded." : "Sign in with GitHub to check workflow runs."}
          </div>
        )}
      </div>
      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}
