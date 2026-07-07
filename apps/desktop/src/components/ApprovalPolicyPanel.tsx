import type { ApprovalDelegationPolicy, ApprovalPolicy } from "@multaiplayer/protocol";

const selectableApprovalPolicies: ApprovalPolicy[] = [
  "ask_every_turn",
  "auto_chat_only",
  "never_host"
];

const selectableDelegationPolicies: ApprovalDelegationPolicy[] = [
  "host_only",
  "members_can_request",
  "members_can_approve",
  "trusted_members_only"
];

export function ApprovalPolicyPanel({
  selectedPolicy,
  selectedDelegationPolicy,
  labels,
  delegationLabels,
  disabled,
  message,
  onSelectPolicy,
  onSelectDelegationPolicy
}: {
  selectedPolicy: ApprovalPolicy;
  selectedDelegationPolicy: ApprovalDelegationPolicy;
  labels: Record<ApprovalPolicy, string>;
  delegationLabels: Record<ApprovalDelegationPolicy, string>;
  disabled: boolean;
  message: string | null;
  onSelectPolicy: (policy: ApprovalPolicy) => void;
  onSelectDelegationPolicy: (policy: ApprovalDelegationPolicy) => void;
}) {
  const delegatedExecution =
    selectedDelegationPolicy === "members_can_approve" || selectedDelegationPolicy === "trusted_members_only";

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
      <div className="panel-subtitle">Delegated approval</div>
      <div className="policy-options">
        {selectableDelegationPolicies.map((policy) => (
          <button
            key={policy}
            className={selectedDelegationPolicy === policy ? "active" : ""}
            onClick={() => onSelectDelegationPolicy(policy)}
            disabled={disabled}
          >
            {delegationLabels[policy]}
          </button>
        ))}
      </div>
      {delegatedExecution && (
        <div className="warning-card">
          Room members can approve Codex turns that may use this host's project folder, terminal, browser context, Git, and Codex usage.
        </div>
      )}
      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}
