export interface AppConfig {
  relayHttpUrl: string;
  relayWsUrl: string;
}

const viteEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

export const defaultRelayHttpUrl = (viteEnv?.VITE_RELAY_HTTP_URL ?? "http://127.0.0.1:4321").replace(/\/$/, "");
export const defaultRelayWsUrl = viteEnv?.VITE_RELAY_URL ?? "ws://127.0.0.1:4321/rooms";

const configKey = "multaiplayer:app-config";

export function loadAppConfig(): AppConfig {
  const stored = localStorage.getItem(configKey);
  if (!stored) return defaultAppConfig();
  try {
    return normalizeAppConfig(JSON.parse(stored) as Partial<AppConfig>);
  } catch {
    localStorage.removeItem(configKey);
    return defaultAppConfig();
  }
}

export function saveAppConfig(config: AppConfig): AppConfig {
  const normalized = normalizeAppConfig(config);
  localStorage.setItem(configKey, JSON.stringify(normalized));
  return normalized;
}

export function resetAppConfig(): AppConfig {
  localStorage.removeItem(configKey);
  return defaultAppConfig();
}

export function getRelayHttpUrl(): string {
  return loadAppConfig().relayHttpUrl;
}

export function normalizeAppConfig(config: Partial<AppConfig>): AppConfig {
  return {
    relayHttpUrl: normalizeHttpUrl(config.relayHttpUrl ?? defaultRelayHttpUrl),
    relayWsUrl: normalizeWsUrl(config.relayWsUrl ?? defaultRelayWsUrl)
  };
}

function defaultAppConfig(): AppConfig {
  return {
    relayHttpUrl: defaultRelayHttpUrl,
    relayWsUrl: defaultRelayWsUrl
  };
}

function normalizeHttpUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Relay HTTP URL must start with http:// or https://");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeWsUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Relay WebSocket URL must start with ws:// or wss://");
  }
  return url.toString().replace(/\/$/, "");
}
