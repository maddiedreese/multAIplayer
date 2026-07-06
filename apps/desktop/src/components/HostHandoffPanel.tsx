import { Check, GitBranch, GitPullRequest, WandSparkles } from "lucide-react";
import { hostHandoffDetail, hostHandoffTitle } from "../lib/hostHandoff";

export interface HostHandoffDisplay {
  id: string;
  status: "available" | "accepted";
  fromHost: string;
  reason?: "manual" | "usage_limit";
  messagesSinceLastCodex: number;
  attachmentNames: string[];
  terminals: string[];
  projectPath: string;
  gitRepoOwner?: string;
  gitRepoName?: string;
  gitBranch?: string;
  gitDirtyFiles?: string[];
  gitPatch?: string;
  gitPatchTruncated?: boolean;
  codexModel: string;
}

export function HostHandoffPanel<T extends HostHandoffDisplay>({
  handoffs,
  acceptDisabled,
  onAcceptHandoff,
  formatModel
}: {
  handoffs: T[];
  acceptDisabled: boolean;
  onAcceptHandoff: (handoff: T) => void;
  formatModel: (model: string) => string;
}) {
  const hasAvailableHandoff = handoffs.some((handoff) => handoff.status === "available");

  return (
    <section className="panel handoff-panel">
      <div className="panel-title">
        <span>Host handoff</span>
        <small className={hasAvailableHandoff ? "panel-state attention" : "panel-state"}>
          {hasAvailableHandoff ? "Available" : "None"}
        </small>
      </div>
      <div className="handoff-list">
        {handoffs.slice(-3).reverse().map((handoff) => (
          <div className={`handoff-row ${handoff.status}`} key={handoff.id}>
            <div>
              <strong className="handoff-title">
                {handoff.reason === "usage_limit" ? <WandSparkles size={14} /> : null}
                {hostHandoffTitle(handoff)}
              </strong>
              <span>{hostHandoffDetail(handoff)}</span>
              <small>
                {handoff.messagesSinceLastCodex} messages · {handoff.attachmentNames.length} attachments · {handoff.terminals.length} terminals · {formatModel(handoff.codexModel)}
              </small>
              {handoff.gitRepoOwner && handoff.gitRepoName ? (
                <small>
                  <GitPullRequest size={12} />
                  Continue from GitHub: {handoff.gitRepoOwner}/{handoff.gitRepoName}{handoff.gitBranch ? `@${handoff.gitBranch}` : ""}
                </small>
              ) : null}
              {handoff.gitDirtyFiles?.length ? (
                <small>
                  <GitBranch size={12} />
                  {handoff.gitPatch && !handoff.gitPatchTruncated
                    ? `Includes an encrypted patch for ${handoff.gitDirtyFiles.length} local change${handoff.gitDirtyFiles.length === 1 ? "" : "s"}.`
                    : handoff.gitPatchTruncated
                      ? "Local changes were too large for automatic patch transfer."
                      : `Previous host has ${handoff.gitDirtyFiles.length} local change${handoff.gitDirtyFiles.length === 1 ? "" : "s"}; ask them to push or share a patch if needed.`}
                </small>
              ) : null}
            </div>
            {handoff.status === "available" ? (
              <button className="handoff-continue-button" onClick={() => onAcceptHandoff(handoff)} disabled={acceptDisabled}>
                <Check size={13} />
                {handoff.reason === "usage_limit" && handoff.gitRepoOwner ? "Continue from GitHub" : "Accept"}
              </button>
            ) : (
              <b>{handoff.status}</b>
            )}
          </div>
        ))}
        {handoffs.length === 0 && (
          <div className="empty-state compact">No host handoff package for this room.</div>
        )}
      </div>
    </section>
  );
}
