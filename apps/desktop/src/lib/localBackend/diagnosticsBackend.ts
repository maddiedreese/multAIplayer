import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./runtime";

export interface PersistedDiagnosticEntry {
  level: "warn" | "error";
  message: string;
  detail?: string;
  createdAt: string;
}

let diagnosticWriteQueue: Promise<void> = Promise.resolve();

export function recordPersistedDiagnostic(entry: PersistedDiagnosticEntry): void {
  if (!isTauriRuntime()) return;
  const persistedEntry = { ...entry };
  diagnosticWriteQueue = diagnosticWriteQueue
    .then(() => invoke<void>("record_diagnostic", { entry: persistedEntry }))
    .catch(() => undefined);
}

export async function exportPersistedDiagnosticEntries(): Promise<unknown[]> {
  if (!isTauriRuntime()) return [];
  try {
    await diagnosticWriteQueue;
    const entries = await invoke<PersistedDiagnosticEntry[]>("export_diagnostic_entries");
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
