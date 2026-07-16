import type { ApprovalPolicy, CodexSandboxLevel, codexSandboxLevelOptions } from "@multaiplayer/protocol";

const selectableApprovalPolicies: ApprovalPolicy[] = ["ask_every_turn", "never_host"];

export function ApprovalPolicyPanel({
  selectedPolicy,
  selectedSandboxLevel,
  labels,
  sandboxOptions,
  disabled,
  message,
  onSelectPolicy,
  onSelectSandboxLevel
}: {
  selectedPolicy: ApprovalPolicy;
  selectedSandboxLevel: CodexSandboxLevel;
  labels: Record<ApprovalPolicy, string>;
  sandboxOptions: typeof codexSandboxLevelOptions;
  disabled: boolean;
  message: string | null;
  onSelectPolicy: (policy: ApprovalPolicy) => void;
  onSelectSandboxLevel: (sandboxLevel: CodexSandboxLevel) => void;
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
