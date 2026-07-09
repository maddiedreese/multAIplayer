import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./runtime";

export interface PersistedDiagnosticEntry {
  level: "warn" | "error";
  message: string;
  detail?: string;
  createdAt: string;
}

export interface DiagnosticExportContext {
  userAgent?: string;
  language?: string;
  platform?: string;
  relayHttpOrigin?: string;
  relayWsOrigin?: string;
}

export type DiagnosticExportOutcome = "saved" | "cancelled" | "unavailable" | "failed";

let diagnosticWriteQueue: Promise<void> = Promise.resolve();

export function recordPersistedDiagnostic(entry: PersistedDiagnosticEntry): void {
  if (!isTauriRuntime()) return;
  const persistedEntry = { ...entry };
  diagnosticWriteQueue = diagnosticWriteQueue
    .then(() => invoke<void>("record_diagnostic", { entry: persistedEntry }))
    .catch(() => undefined);
}

export async function savePersistedDiagnosticBundle(
  context: DiagnosticExportContext
): Promise<DiagnosticExportOutcome> {
  if (!isTauriRuntime()) return "unavailable";
  try {
    await diagnosticWriteQueue;
    const outcome = await invoke<"saved" | "cancelled">("save_diagnostic_bundle", { context });
    return outcome === "saved" || outcome === "cancelled" ? outcome : "failed";
  } catch {
    return "failed";
  }
}
