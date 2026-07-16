import { Check, GitBranch, GitPullRequest, WandSparkles } from "lucide-react";
import { hostHandoffDetail, hostHandoffTitle } from "../lib/handoff/hostHandoff";

export interface HostHandoffDisplay {
  id: string;
  status: "available" | "requested" | "accepted";
  candidateDeviceId?: string | undefined;
  fromHost: string;
  reason: "manual" | "usage_limit";
  messagesSinceLastCodex: number;
  queuedCodexTurns: Array<{
    turnId: string;
    requestedBy: string;
  }>;
  attachmentNames: string[];
  terminals: string[];
  projectPath: string;
  gitRepoOwner?: string | undefined;
  gitRepoName?: string | undefined;
  gitBranch?: string | undefined;
  gitDirtyFiles?: string[] | undefined;
  gitPatch?: string | undefined;
  gitPatchTruncated?: boolean | undefined;
  patchAppliedLocally?: boolean | undefined;
  codexModel: string;
}

export function HostHandoffPanel<T extends HostHandoffDisplay>({
  handoffs,
  acceptDisabled,
  patchApplyDisabled,
  onAcceptHandoff,
  formatModel
}: {
  handoffs: T[];
  acceptDisabled: boolean;
  patchApplyDisabled?: boolean;
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
        {handoffs
          .slice(-3)
          .reverse()
          .map((handoff) => (
            <HostHandoffRow
              key={handoff.id}
              handoff={handoff}
              acceptDisabled={acceptDisabled}
              {...(patchApplyDisabled === undefined ? {} : { patchApplyDisabled })}
              onAcceptHandoff={onAcceptHandoff}
              formatModel={formatModel}
            />
          ))}
        {handoffs.length === 0 && <div className="empty-state compact">No host handoff package for this room.</div>}
      </div>
    </section>
  );
}

function HostHandoffRow<T extends HostHandoffDisplay>({
  handoff,
  acceptDisabled,
  patchApplyDisabled,
  onAcceptHandoff,
  formatModel
}: {
  handoff: T;
  acceptDisabled: boolean;
  patchApplyDisabled?: boolean;
  onAcceptHandoff: (handoff: T) => void;
  formatModel: (model: string) => string;
}) {
  return (
    <div className={`handoff-row ${handoff.status}`}>
      <div>
        <strong className="handoff-title">
          {handoff.reason === "usage_limit" ? <WandSparkles size={14} /> : null}
          {hostHandoffTitle(handoff)}
        </strong>
        <span>{hostHandoffDetail(handoff)}</span>
        <small>
          {handoff.messagesSinceLastCodex} messages · {handoff.queuedCodexTurns.length} queued ·{" "}
          {handoff.attachmentNames.length} attachments · {handoff.terminals.length} terminals ·{" "}
          {formatModel(handoff.codexModel)}
        </small>
        <HandoffGitContext handoff={handoff} />
        {handoff.status === "accepted" && handoff.gitPatch && !handoff.patchAppliedLocally ? (
          <details className="handoff-patch-review">
            <summary>Review staged patch</summary>
            <pre>{handoff.gitPatch}</pre>
          </details>
        ) : null}
      </div>
      <HandoffAction
        handoff={handoff}
        acceptDisabled={acceptDisabled}
        {...(patchApplyDisabled === undefined ? {} : { patchApplyDisabled })}
        onAcceptHandoff={onAcceptHandoff}
      />
    </div>
  );
}

function HandoffGitContext({ handoff }: { handoff: HostHandoffDisplay }) {
  const dirtyCount = handoff.gitDirtyFiles?.length ?? 0;
  const patchDetail =
    handoff.gitPatch && !handoff.gitPatchTruncated
      ? `Includes an encrypted patch for ${dirtyCount} local change${dirtyCount === 1 ? "" : "s"}.`
      : handoff.gitPatchTruncated
        ? "Local changes were too large for automatic patch transfer."
        : `Previous host has ${dirtyCount} local change${dirtyCount === 1 ? "" : "s"}; ask them to push or share a patch if needed.`;
  return (
    <>
      {handoff.gitRepoOwner && handoff.gitRepoName ? (
        <small>
          <GitPullRequest size={12} />
          Continue from GitHub: {handoff.gitRepoOwner}/{handoff.gitRepoName}
          {handoff.gitBranch ? `@${handoff.gitBranch}` : ""}
        </small>
      ) : null}
      {dirtyCount > 0 ? (
        <small>
          <GitBranch size={12} />
          {patchDetail}
        </small>
      ) : null}
    </>
  );
}

function HandoffAction<T extends HostHandoffDisplay>({
  handoff,
  acceptDisabled,
  patchApplyDisabled,
  onAcceptHandoff
}: {
  handoff: T;
  acceptDisabled: boolean;
  patchApplyDisabled?: boolean;
  onAcceptHandoff: (handoff: T) => void;
}) {
  const patchPending = handoff.status === "accepted" && Boolean(handoff.gitPatch) && !handoff.patchAppliedLocally;
  if (patchPending)
    return (
      <button
        className="handoff-continue-button"
        onClick={() => onAcceptHandoff(handoff)}
        disabled={acceptDisabled || patchApplyDisabled}
      >
        <Check size={13} />
        Apply reviewed patch
      </button>
    );
  if (handoff.status === "accepted") return <b>{handoff.status}</b>;
  const label =
    handoff.status === "requested"
      ? "Approve candidate"
      : handoff.reason === "usage_limit" && handoff.gitRepoOwner
        ? "Request from GitHub"
        : "Request handoff";
  return (
    <button className="handoff-continue-button" onClick={() => onAcceptHandoff(handoff)} disabled={acceptDisabled}>
      <Check size={13} />
      {label}
    </button>
  );
}
