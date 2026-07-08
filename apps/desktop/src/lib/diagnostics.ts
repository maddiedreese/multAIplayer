import { loadAppConfig } from "./appConfig";
import { appVersion } from "./appVersion";

export type DiagnosticLevel = "warn" | "error";

export interface DiagnosticEntry {
  level: DiagnosticLevel;
  message: string;
  detail?: string;
  createdAt: string;
}

const diagnosticStorageKey = "multaiplayer:diagnostics:v1";
const maxDiagnosticEntries = 80;
let installed = false;

export function installGlobalDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.warn = (...args: unknown[]) => {
    recordDiagnosticEvent("warn", "Console warning", ...args);
    originalWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    recordDiagnosticEvent("error", "Console error", ...args);
    originalError(...args);
  };
  window.addEventListener("error", (event) => {
    recordDiagnosticEvent("error", "Uncaught error", event.message, event.error);
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordDiagnosticEvent("error", "Unhandled promise rejection", event.reason);
  });
}

export function recordDiagnosticEvent(level: DiagnosticLevel, message: string, ...details: unknown[]) {
  const entries = loadDiagnosticEntries();
  const nextEntry: DiagnosticEntry = {
    level,
    message: boundText(redactText(message), 240),
    detail: details.length ? boundText(redactText(details.map(formatDiagnosticValue).join(" ")), 800) : undefined,
    createdAt: new Date().toISOString()
  };
  saveDiagnosticEntries([...entries, nextEntry].slice(-maxDiagnosticEntries));
}

export function buildDiagnosticBundle(now = new Date()): string {
  const config = safeLoadAppConfig();
  const bundle = {
    generatedAt: now.toISOString(),
    app: {
      version: appVersion,
      runtime: isTauriRuntime() ? "tauri" : "web-preview",
      userAgent: typeof navigator === "undefined" ? "unavailable" : navigator.userAgent,
      language: typeof navigator === "undefined" ? "unavailable" : navigator.language,
      platform: typeof navigator === "undefined" ? "unavailable" : navigator.platform
    },
    relay: {
      httpOrigin: config ? safeOrigin(config.relayHttpUrl) : "unavailable",
      wsOrigin: config ? safeOrigin(config.relayWsUrl) : "unavailable"
    },
    entries: loadDiagnosticEntries()
  };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function loadDiagnosticEntries(): DiagnosticEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(diagnosticStorageKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: DiagnosticEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        if (
          record.level !== "warn" &&
          record.level !== "error"
        ) continue;
      if (typeof record.message !== "string" || typeof record.createdAt !== "string") continue;
      entries.push({
          level: record.level,
          message: boundText(redactText(record.message), 240),
          detail: typeof record.detail === "string" ? boundText(redactText(record.detail), 800) : undefined,
          createdAt: record.createdAt
      });
    }
    return entries.slice(-maxDiagnosticEntries);
  } catch {
    localStorage.removeItem(diagnosticStorageKey);
    return [];
  }
}

function saveDiagnosticEntries(entries: DiagnosticEntry[]) {
  try {
    localStorage.setItem(diagnosticStorageKey, JSON.stringify(entries));
  } catch {
    // Diagnostics are best-effort and must never interrupt app behavior.
  }
}

function formatDiagnosticValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redactText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"')]+/g, (match) => {
      try {
        const parsed = new URL(match);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "[url]";
      }
    })
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted-token]");
}

function boundText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function safeLoadAppConfig(): ReturnType<typeof loadAppConfig> | null {
  try {
    return loadAppConfig();
  } catch {
    return null;
  }
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "unavailable";
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
