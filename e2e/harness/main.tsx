import React from "react";
import { createRoot } from "react-dom/client";
import "../../apps/desktop/src/styles.css";
import "./styles.css";

export interface UiContractScenarioModule {
  default: React.ComponentType;
  description: string;
  mockedBoundaries: readonly string[];
}

const scenarioModules = import.meta.glob<UiContractScenarioModule>("./scenarios/*.tsx");

function scenarioModulePath(name: string): string {
  return `./scenarios/${name}.tsx`;
}

function Harness() {
  const scenarioName = new URLSearchParams(window.location.search).get("scenario") ?? "";
  const loader = scenarioModules[scenarioModulePath(scenarioName)];
  const [scenario, setScenario] = React.useState<UiContractScenarioModule | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setScenario(null);
    setLoadError(null);
    if (!loader) {
      setLoadError(`Unknown UI-contract scenario: ${scenarioName || "(missing)"}`);
      return;
    }
    void loader()
      .then(setScenario)
      .catch((error: unknown) => setLoadError(String(error)));
  }, [loader, scenarioName]);

  if (loadError) return <main className="e2e-harness-error">{loadError}</main>;
  if (!scenario) return <main className="e2e-harness-loading">Loading UI-contract scenario…</main>;

  const Scenario = scenario.default;
  return (
    <main className="e2e-harness-shell">
      <aside className="e2e-harness-boundary" aria-label="E2E coverage boundary">
        <strong>UI-contract E2E harness</strong>
        <span>{scenario.description}</span>
        <span>Simulated boundaries: {scenario.mockedBoundaries.join(", ") || "none"}</span>
      </aside>
      <Scenario />
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>
);
