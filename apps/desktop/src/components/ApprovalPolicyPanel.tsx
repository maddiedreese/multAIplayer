import type { ApprovalPolicy } from "@multaiplayer/protocol";

const selectableApprovalPolicies: ApprovalPolicy[] = [
  "ask_every_turn",
  "auto_chat_only",
  "never_host"
];

export function ApprovalPolicyPanel({
  selectedPolicy,
  labels,
  disabled,
  message,
  onSelectPolicy
}: {
  selectedPolicy: ApprovalPolicy;
  labels: Record<ApprovalPolicy, string>;
  disabled: boolean;
  message: string | null;
  onSelectPolicy: (policy: ApprovalPolicy) => void;
}) {
  return (
    <section className="panel policy-panel">
      <div className="panel-title">
        <span>Approval policy</span>
        <small className="panel-state attention">Host-side</small>
      </div>
      <div className="policy-options">
        {selectableApprovalPolicies.map((policy) => (
          <button
            key={policy}
            className={selectedPolicy === policy ? "active" : ""}
            onClick={() => onSelectPolicy(policy)}
            disabled={disabled}
          >
            {labels[policy]}
          </button>
        ))}
      </div>
      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}
