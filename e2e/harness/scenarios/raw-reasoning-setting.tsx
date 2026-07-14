import React from "react";
import { ModelPanel } from "../../../apps/desktop/src/components/ModelPanel";

export const description =
  "Production model settings expose the host-controlled, off-by-default room sharing choice for provider-supplied raw reasoning.";
export const mockedBoundaries = ["active-host relay authorization", "MLS settings-event delivery"] as const;

const options = [{ id: "standard", label: "Standard", description: "Standard" }] as const;

export default function RawReasoningSettingScenario() {
  const [enabled, setEnabled] = React.useState(false);
  return (
    <section className="e2e-model-setting" aria-label="Raw reasoning room setting UI contract">
      <ModelPanel
        selectedModel="gpt-5.6-sol"
        selectedModelLabel="GPT-5.6 Sol"
        selectedReasoningEffort="standard"
        rawReasoningEnabled={enabled}
        selectedSpeed="standard"
        customModel="gpt-5.6-sol"
        modelOptions={[{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Current Codex model" }]}
        reasoningOptions={options}
        speedOptions={options}
        disabled={false}
        canApplyCustomModel={false}
        onSelectModel={() => undefined}
        onSelectReasoningEffort={() => undefined}
        onRawReasoningEnabledChange={setEnabled}
        onSelectSpeed={() => undefined}
        onCustomModelChange={() => undefined}
        onApplyCustomModel={() => undefined}
      />
      <p role="status">Raw reasoning sharing is {enabled ? "enabled for future room activity" : "off"}.</p>
    </section>
  );
}
