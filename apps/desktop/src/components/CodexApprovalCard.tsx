import { AlertTriangle, Bot, Check, KeyRound, X } from "lucide-react";
import type { CodexTurnRiskFlag } from "../lib/codexTurn";
import { ApprovalItem, StatusPill } from "./common";

export type CodexApprovalSummaryDisplay = {
  messages: string;
  attachments: string;
  sandbox: string;
  riskFlags: CodexTurnRiskFlag[];
  highPrivilegeLabels: string[];
};

export function CodexApprovalCard({
  summary,
  isActiveHost,
  codexRunning,
  canApprove,
  onApprove,
  onDeny
}: {
  summary: CodexApprovalSummaryDisplay;
  isActiveHost: boolean;
  codexRunning: boolean;
  canApprove: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const highPrivilegeLabels = summary.highPrivilegeLabels ?? [];
  return (
    <section className="approval-card">
      <div className="approval-title">
        <div>
          <Bot size={19} />
          <strong>Approve Codex turn</strong>
        </div>
        <StatusPill
          icon={<KeyRound size={14} />}
          label={isActiveHost ? "host-side approval" : "host locked"}
          tone={isActiveHost ? "yellow" : "muted"}
        />
      </div>
      <div className="approval-grid">
        <ApprovalItem label="Messages" value={summary.messages} />
        <ApprovalItem label="Attachments" value={summary.attachments} />
        <ApprovalItem label="Sandbox" value={summary.sandbox} />
      </div>
      {highPrivilegeLabels.length > 0 && (
        <div className="approval-risk-list high-privilege">
          <div className="approval-risk-title">
            <AlertTriangle size={16} />
            <strong>High-privilege host action</strong>
          </div>
          <div className="approval-risk-item">
            This turn can use {highPrivilegeLabels.join(", ")} on the active host's machine.
          </div>
        </div>
      )}
      {summary.riskFlags.length > 0 && (
        <div className="approval-risk-list">
          <div className="approval-risk-title">
            <AlertTriangle size={16} />
            <strong>Review warnings</strong>
          </div>
          {summary.riskFlags.map((flag) => (
            <div className="approval-risk-item" key={flag.id}>
              {flag.label}
            </div>
          ))}
        </div>
      )}
      <div className="approval-actions">
        <button className="secondary" onClick={onDeny}>
          <X size={16} /> Deny
        </button>
        <button className="primary" onClick={onApprove} disabled={codexRunning || !canApprove}>
          <Check size={16} /> {codexRunning ? "Running" : "Approve"}
        </button>
      </div>
    </section>
  );
}
