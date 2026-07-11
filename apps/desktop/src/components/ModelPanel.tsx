import { Check } from "lucide-react";

export type ModelOptionDisplay = {
  id: string;
  label: string;
  description: string;
};

export function ModelPanel({
  selectedModel,
  selectedModelLabel,
  selectedReasoningEffort,
  selectedSpeed,
  customModel,
  modelOptions,
  reasoningOptions,
  speedOptions,
  disabled,
  canApplyCustomModel,
  onSelectModel,
  onSelectReasoningEffort,
  onSelectSpeed,
  onCustomModelChange,
  onApplyCustomModel
}: {
  selectedModel: string;
  selectedModelLabel: string;
  selectedReasoningEffort: string;
  selectedSpeed: string;
  customModel: string;
  modelOptions: readonly ModelOptionDisplay[];
  reasoningOptions: readonly ModelOptionDisplay[];
  speedOptions: readonly ModelOptionDisplay[];
  disabled: boolean;
  canApplyCustomModel: boolean;
  onSelectModel: (model: string) => void;
  onSelectReasoningEffort: (effort: string) => void;
  onSelectSpeed: (speed: string) => void;
  onCustomModelChange: (model: string) => void;
  onApplyCustomModel: () => void;
}) {
  const knownModelSelected = modelOptions.some((option) => option.id === selectedModel);

  return (
    <section className="panel model-panel">
      <div className="panel-title">
        <span>Model</span>
        <small className="panel-state available">{selectedModelLabel}</small>
      </div>
      <label>
        <span>Codex host model</span>
        <select
          value={knownModelSelected ? selectedModel : "custom"}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value !== "custom") {
              onSelectModel(event.target.value);
            }
          }}
        >
          {modelOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      <label>
        <span>Reasoning</span>
        <select
          value={selectedReasoningEffort}
          disabled={disabled}
          onChange={(event) => onSelectReasoningEffort(event.target.value)}
        >
          {reasoningOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Speed</span>
        <select value={selectedSpeed} disabled={disabled} onChange={(event) => onSelectSpeed(event.target.value)}>
          {speedOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Custom model ID</span>
        <div className="custom-model-row">
          <input
            value={customModel}
            disabled={disabled}
            onChange={(event) => onCustomModelChange(event.target.value)}
            onBlur={onApplyCustomModel}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onApplyCustomModel();
              }
            }}
          />
          <button
            onClick={onApplyCustomModel}
            disabled={disabled || !canApplyCustomModel}
            title="Apply custom model"
            aria-label="Apply custom model"
          >
            <Check size={13} />
          </button>
        </div>
      </label>
      <div className="model-options">
        {modelOptions.map((option) => (
          <button
            key={option.id}
            className={selectedModel === option.id ? "active" : ""}
            disabled={disabled}
            onClick={() => onSelectModel(option.id)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
      <div className="model-options compact">
        {reasoningOptions.map((option) => (
          <button
            key={option.id}
            className={selectedReasoningEffort === option.id ? "active" : ""}
            disabled={disabled}
            onClick={() => onSelectReasoningEffort(option.id)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
      <div className="model-options compact">
        {speedOptions.map((option) => (
          <button
            key={option.id}
            className={selectedSpeed === option.id ? "active" : ""}
            disabled={disabled}
            onClick={() => onSelectSpeed(option.id)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
