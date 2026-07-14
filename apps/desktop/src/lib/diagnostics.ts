import { loadAppConfig } from "./appConfig";
import { configureNonFatalReporter } from "./nonFatalReporting";
import {
  recordPersistedDiagnostic,
  savePersistedDiagnosticBundle,
  type DiagnosticExportOutcome,
  type PersistedDiagnosticEntry
} from "./localBackend/diagnosticsBackend";

export type DiagnosticLevel = "warn" | "error";

export interface DiagnosticEntry {
  level: DiagnosticLevel;
  message: string;
  detail?: string;
  createdAt: string;
}

const maxDiagnosticEntries = 80;
const maxDiagnosticObjectDepth = 6;
const maxDiagnosticObjectKeys = 40;
const maxDiagnosticArrayItems = 40;
const omittedValue = "[omitted]";
const exactSensitiveDiagnosticKeys = new Set(["body", "plaintext"]);
const sensitiveDiagnosticKeySuffixes = ["key", "token", "secret", "passphrase"] as const;
let installed = false;
let diagnosticEntries: DiagnosticEntry[] = [];

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
  const nextEntry: DiagnosticEntry = {
    level,
    message: boundText(redactText(message), 240),
    detail: details.length ? boundText(redactText(details.map(formatDiagnosticValue).join(" ")), 800) : undefined,
    createdAt: new Date().toISOString()
  };
  appendDiagnosticEntry(nextEntry);
}

/**
 * Records an unexpected, recoverable failure without exposing application data.
 * Callers should pass a stable operation name and omit attacker-controlled values.
 */
configureNonFatalReporter((operation, error) => {
  recordDiagnosticEvent("warn", `Non-fatal failure: ${operation}`, ...(error === undefined ? [] : [error]));
});

export async function saveNativeDiagnosticBundle(): Promise<DiagnosticExportOutcome> {
  const config = safeLoadAppConfig();
  return savePersistedDiagnosticBundle({
    userAgent: typeof navigator === "undefined" ? "unavailable" : navigator.userAgent,
    language: typeof navigator === "undefined" ? "unavailable" : navigator.language,
    platform: typeof navigator === "undefined" ? "unavailable" : navigator.platform,
    relayHttpOrigin: config ? safeOrigin(config.relayHttpUrl) : "unavailable",
    relayWsOrigin: config ? safeOrigin(config.relayWsUrl) : "unavailable"
  });
}

export function loadDiagnosticEntries(): DiagnosticEntry[] {
  return diagnosticEntries.map((entry) => ({ ...entry }));
}

function appendDiagnosticEntry(entry: DiagnosticEntry) {
  diagnosticEntries = [...diagnosticEntries, { ...entry }].slice(-maxDiagnosticEntries);
  recordPersistedDiagnostic(entry satisfies PersistedDiagnosticEntry);
}

export function clearDiagnosticEntries() {
  diagnosticEntries = [];
}

function formatDiagnosticValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    if (value instanceof Error) {
      const name = readDataStringProperty(value, "name") ?? "Error";
      const message = readDataStringProperty(value, "message") ?? "";
      return message ? `${name}: ${message}` : name;
    }
  } catch {
    console.debug("[expected failure] diagnostic Error fields were not safely readable");
    return "[unserializable]";
  }
  try {
    return JSON.stringify(sanitizeDiagnosticValue(value, 0, new WeakSet<object>()));
  } catch {
    console.debug("[expected failure] diagnostic value was not serializable");
    return "[unserializable]";
  }
}

function sanitizeDiagnosticValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return "[symbol]";
  if (typeof value !== "object") return "[unserializable]";
  if (depth >= maxDiagnosticObjectDepth) return "[max-depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    console.debug("[expected failure] diagnostic object descriptors were not readable");
    return "[unserializable]";
  }

  if (Array.isArray(value)) {
    const lengthDescriptor = descriptors.length;
    const length = typeof lengthDescriptor?.value === "number" ? lengthDescriptor.value : 0;
    const itemCount = Math.min(length, maxDiagnosticArrayItems);
    const result: unknown[] = [];
    for (let index = 0; index < itemCount; index += 1) {
      const descriptor = descriptors[String(index)];
      result.push(
        descriptor && "value" in descriptor
          ? sanitizeDiagnosticValue(descriptor.value, depth + 1, seen)
          : "[unavailable]"
      );
    }
    if (length > maxDiagnosticArrayItems) result.push("[truncated]");
    return result;
  }

  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const enumerableKeys = Object.keys(descriptors).filter((key) => descriptors[key]?.enumerable);
  const keys = enumerableKeys.slice(0, maxDiagnosticObjectKeys);
  for (const key of keys) {
    if (isSensitiveDiagnosticKey(key)) {
      result[key] = omittedValue;
      continue;
    }
    const descriptor = descriptors[key];
    result[key] =
      descriptor && "value" in descriptor
        ? sanitizeDiagnosticValue(descriptor.value, depth + 1, seen)
        : "[unavailable]";
  }
  if (enumerableKeys.length > maxDiagnosticObjectKeys) {
    result["[truncated]"] = true;
  }
  return result;
}

function readDataStringProperty(value: object, key: string): string | undefined {
  let current: object | null = value;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function isSensitiveDiagnosticKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, "");
  return (
    exactSensitiveDiagnosticKeys.has(normalizedKey) ||
    sensitiveDiagnosticKeySuffixes.some((suffix) => normalizedKey.endsWith(suffix))
  );
}

function redactText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"')]+/g, (match) => {
      try {
        const parsed = new URL(match);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        console.debug("[expected failure] diagnostic URL redaction rejected malformed input");
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
    console.debug("[expected failure] diagnostic app configuration was unavailable");
    return null;
  }
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    console.debug("[expected failure] diagnostic relay origin was unavailable");
    return "unavailable";
  }
}
