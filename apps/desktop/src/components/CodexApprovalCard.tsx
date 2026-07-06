import { Bot, Check, KeyRound, X } from "lucide-react";
import { ApprovalItem, StatusPill } from "./common";

export type CodexApprovalSummaryDisplay = {
  messages: string;
  attachments: string;
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
      </div>
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
