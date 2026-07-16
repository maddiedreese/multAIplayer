import React from "react";
import { MonacoFileEditor } from "../../../apps/desktop/src/components/MonacoFileEditor";

export const description =
  "The production Monaco bundle starts its offline TypeScript, JSON, CSS, and HTML language-service workers.";
export const mockedBoundaries: readonly string[] = [];

const probes = [
  { path: "/src/probe.ts", value: 'const message = "ready";\nmessage.' },
  { path: "/src/probe.js", value: 'const message = "ready";\nmessage.' },
  { path: "/config/probe.json", value: '{ "ready": tru }' },
  { path: "/styles/probe.css", value: ".probe { dis" },
  { path: "/views/probe.html", value: "<bu" }
] as const;

export default function MonacoLanguageServicesScenario() {
  return (
    <section aria-label="Monaco language-service probes">
      <h1>Monaco language-service probes</h1>
      {probes.map((probe) => (
        <div key={probe.path} data-monaco-probe={probe.path} style={{ height: 160, marginBottom: 16 }}>
          <MonacoFileEditor path={probe.path} value={probe.value} disabled={false} onChange={() => undefined} />
        </div>
      ))}
    </section>
  );
}
