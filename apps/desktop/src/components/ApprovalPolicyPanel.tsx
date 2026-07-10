import type {
  ApprovalDelegationPolicy,
  ApprovalPolicy,
  CodexSandboxLevel,
  codexSandboxLevelOptions
} from "@multaiplayer/protocol";

const selectableApprovalPolicies: ApprovalPolicy[] = ["ask_every_turn", "never_host"];

const selectableDelegationPolicies: ApprovalDelegationPolicy[] = ["host_only", "members_can_request"];

export function ApprovalPolicyPanel({
  selectedPolicy,
  selectedDelegationPolicy,
  selectedSandboxLevel,
  labels,
  delegationLabels,
  sandboxOptions,
  disabled,
  message,
  onSelectPolicy,
  onSelectDelegationPolicy,
  onSelectSandboxLevel
}: {
  selectedPolicy: ApprovalPolicy;
  selectedDelegationPolicy: ApprovalDelegationPolicy;
  selectedSandboxLevel: CodexSandboxLevel;
  labels: Record<ApprovalPolicy, string>;
  delegationLabels: Record<ApprovalDelegationPolicy, string>;
  sandboxOptions: typeof codexSandboxLevelOptions;
  disabled: boolean;
  message: string | null;
  onSelectPolicy: (policy: ApprovalPolicy) => void;
  onSelectDelegationPolicy: (policy: ApprovalDelegationPolicy) => void;
  onSelectSandboxLevel: (sandboxLevel: CodexSandboxLevel) => void;
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
          Legacy delegated approval settings no longer authorize Codex turns. Only the active host can approve execution
          on the host machine.
        </div>
      )}
      <div className="panel-subtitle">Codex sandbox</div>
      <div className="model-options compact">
        {sandboxOptions.map((option) => (
          <button
            key={option.id}
            className={selectedSandboxLevel === option.id ? "active" : ""}
            onClick={() => onSelectSandboxLevel(option.id)}
            disabled={disabled}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}
