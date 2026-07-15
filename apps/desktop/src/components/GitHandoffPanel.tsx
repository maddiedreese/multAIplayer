import { Copy } from "lucide-react";
import { GitHubIcon } from "./GitHubIcon";
import type { GitWorkflowApprovalPreview } from "@multaiplayer/git";
import type { GitHubWorkflowReadiness } from "../lib/git/githubWorkflowReadiness";
import type { GitWorkflowDraft } from "../lib/git/gitWorkflowDraft";

export interface GitApprovalPreviewDisplay {
  error: string | null;
  steps: GitWorkflowApprovalPreview[];
}

export function GitHandoffPanel({
  draft,
  preview,
  readiness,
  canReadLocalWorkspace,
  gitWorkflowBusy,
  isActiveHost,
  message,
  onDraftChange,
  onCopyPullRequestDraftMarkdown,
  onApproveGitWorkflow
}: {
  draft: GitWorkflowDraft;
  preview: GitApprovalPreviewDisplay;
  readiness: GitHubWorkflowReadiness;
  canReadLocalWorkspace: boolean;
  gitWorkflowBusy: boolean;
  isActiveHost: boolean;
  message: string | null;
  onDraftChange: (patch: Partial<GitWorkflowDraft>) => void;
  onCopyPullRequestDraftMarkdown: () => void;
  onApproveGitWorkflow: () => void;
}) {
  return (
    <section className="panel git-approval-panel">
      <div className="panel-title">
        <span>GitHub handoff</span>
        <small className="panel-state attention">Approval required</small>
      </div>
      <label>
        <span>Branch</span>
        <input value={draft.branchName} onChange={(event) => onDraftChange({ branchName: event.target.value })} />
      </label>
      <label>
        <span>Commit message</span>
        <input value={draft.commitMessage} onChange={(event) => onDraftChange({ commitMessage: event.target.value })} />
      </label>
      <div className="repo-grid">
        <label>
          <span>Owner</span>
          <input value={draft.prOwner} onChange={(event) => onDraftChange({ prOwner: event.target.value })} />
        </label>
        <label>
          <span>Repo</span>
          <input value={draft.prRepo} onChange={(event) => onDraftChange({ prRepo: event.target.value })} />
        </label>
        <label>
          <span>Base</span>
          <input value={draft.prBase} onChange={(event) => onDraftChange({ prBase: event.target.value })} />
        </label>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.pushEnabled}
          onChange={(event) => onDraftChange({ pushEnabled: event.target.checked })}
        />
        <span>Push branch and open draft PR</span>
      </label>
      <div className="git-approval-preview">
        <strong>Host will approve</strong>
        {preview.error ? (
          <div className="workflow-message danger">{preview.error}</div>
        ) : (
          preview.steps.map((step) => (
            <div className="git-approval-step" key={step.title}>
              <span>{step.title}</span>
              <small>{step.detail}</small>
              {step.commands.map((command) => (
                <code key={command}>{command}</code>
              ))}
            </div>
          ))
        )}
        {draft.pushEnabled && !preview.error && (
          <small>
            Draft PR target:{" "}
            {readiness.target ?? `${draft.prOwner}/${draft.prRepo} to ${readiness.normalizedBase || "main"}`}
          </small>
        )}
      </div>
      {draft.pushEnabled && (
        <div className={`workflow-message ${readiness.ready ? "" : "danger"}`}>{readiness.messages.join(" ")}</div>
      )}
      <button className="ghost-wide" onClick={onCopyPullRequestDraftMarkdown} disabled={!canReadLocalWorkspace}>
        <Copy size={15} />
        Copy PR draft
      </button>
      <button
        className="primary-wide"
        onClick={onApproveGitWorkflow}
        disabled={
          !canReadLocalWorkspace ||
          gitWorkflowBusy ||
          !isActiveHost ||
          Boolean(preview.error) ||
          (draft.pushEnabled && !readiness.ready)
        }
      >
        <GitHubIcon size={15} />
        {gitWorkflowBusy ? "Running approved git workflow" : "Approve git workflow"}
      </button>
      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}
