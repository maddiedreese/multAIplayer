import { existsSync, readFileSync } from "node:fs";
import { logRelayEvent } from "./observability.js";
import { resolve } from "node:path";
import type { RelayStorageBackend } from "./persistence.js";

export interface RelayConfig {
  nodeEnv: string;
  port: number;
  githubClientId: string | undefined;
  githubOAuthScopes: string[];
  dataPath: string;
  storageBackend: RelayStorageBackend;
  legacyJsonImportPath: string | null;
  encryptedBacklogLimit: number;
  encryptedBacklogRetentionDays: number;
  inviteTtlDays: number;
  attachmentBlobTtlDays: number;
  attachmentBlobMaxBytes: number;
  attachmentBlobLiveQuotaBytes: number;
  attachmentBlobUploadBytesPerWindow: number;
  attachmentBlobUploadWindowMs: number;
  jsonBodyLimitBytes: number;
  encryptedEnvelopeMaxBytes: number;
  roomEpochEnvelopeLimit: number;
  sessionPersistenceSecret: string | null;
  debugEndpointsEnabled: boolean;
  allowedCorsOrigins: string[];
  seedDemoWorkspace: boolean;
  mutationsRequireAuth: boolean;
  rateLimitsEnabled: boolean;
  trustProxyHeaders: boolean;
  structuredLogsEnabled: boolean;
  rateLimitWindowMs: number;
  rateLimitCaps: {
    auth: number;
    read: number;
    mutation: number;
    attachment: number;
    websocket: number;
    websocketConnect: number;
  };
  websocketConnectionCaps: {
    perUser: number;
    perDevice: number;
  };
  shutdown: {
    drainMs: number;
    graceMs: number;
  };
  dailyCreationCaps: {
    teamsPerUser: number;
    roomsPerUser: number;
  };
  totalRoomCapPerUser: number;
}

export function loadRelayConfig(): RelayConfig {
  loadRelayEnvFiles();

  const nodeEnv = process.env.NODE_ENV ?? "development";
  const storageBackend = parseStorageBackend(process.env.MULTAIPLAYER_RELAY_STORAGE);
  const storageWasExplicit = process.env.MULTAIPLAYER_RELAY_STORAGE !== undefined;
  const dataPathWasExplicit = process.env.MULTAIPLAYER_RELAY_DATA_PATH !== undefined;
  const defaultLegacyJsonPath = resolve(".multaiplayer/relay-store.json");
  const attachmentBlobMaxBytes = parseIntegerEnv(
    process.env.MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES,
    5_000_000,
    1,
    50_000_000
  );
  const jsonBodyLimitBytes = Math.ceil(Math.max(1_000_000, attachmentBlobMaxBytes * 1.5 + 100_000));

  return {
    nodeEnv,
    port: parseIntegerEnv(process.env.PORT, 4321, 1, 65_535),
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubOAuthScopes: parseGitHubScopes(process.env.GITHUB_OAUTH_SCOPES),
    dataPath: resolve(
      process.env.MULTAIPLAYER_RELAY_DATA_PATH ??
        `.multaiplayer/relay-store.${storageBackend === "sqlite" ? "sqlite" : "json"}`
    ),
    storageBackend,
    legacyJsonImportPath:
      storageBackend === "sqlite" && !storageWasExplicit && !dataPathWasExplicit && existsSync(defaultLegacyJsonPath)
        ? defaultLegacyJsonPath
        : null,
    encryptedBacklogLimit: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_BACKLOG_LIMIT, 200, 1, 1000),
    encryptedBacklogRetentionDays: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_BACKLOG_RETENTION_DAYS, 30, 1, 365),
    inviteTtlDays: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_INVITE_TTL_DAYS, 7, 1, 365),
    attachmentBlobTtlDays: parseIntegerEnv(process.env.MULTAIPLAYER_ATTACHMENT_BLOB_TTL_DAYS, 30, 1, 365),
    attachmentBlobMaxBytes,
    attachmentBlobLiveQuotaBytes: parseIntegerEnv(
      process.env.MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES,
      250_000_000,
      attachmentBlobMaxBytes,
      10_000_000_000
    ),
    attachmentBlobUploadBytesPerWindow: parseIntegerEnv(
      process.env.MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW,
      100_000_000,
      attachmentBlobMaxBytes,
      10_000_000_000
    ),
    attachmentBlobUploadWindowMs: parseIntegerEnv(
      process.env.MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_WINDOW_MS,
      3_600_000,
      60_000,
      86_400_000
    ),
    jsonBodyLimitBytes,
    encryptedEnvelopeMaxBytes: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_ENVELOPE_MAX_BYTES,
      1_000_000,
      4096,
      5_000_000
    ),
    roomEpochEnvelopeLimit: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_EPOCH_ENVELOPE_LIMIT,
      1_000_000,
      1,
      100_000_000
    ),
    sessionPersistenceSecret: normalizeSessionPersistenceSecret(process.env.MULTAIPLAYER_RELAY_SESSION_SECRET),
    debugEndpointsEnabled: parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_DEBUG, false),
    allowedCorsOrigins: parseAllowedOriginEnv(process.env.MULTAIPLAYER_RELAY_ALLOWED_ORIGINS),
    seedDemoWorkspace: parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_SEED_DEMO, nodeEnv !== "production"),
    mutationsRequireAuth: parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_REQUIRE_AUTH, nodeEnv === "production"),
    rateLimitsEnabled: parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMITS, true),
    trustProxyHeaders:
      parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS, false) &&
      parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED, false),
    structuredLogsEnabled: parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_STRUCTURED_LOGS, nodeEnv === "production"),
    rateLimitWindowMs: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000),
    rateLimitCaps: {
      auth: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_AUTH, 30, 1, 10_000),
      read: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_READ, 300, 1, 100_000),
      mutation: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_MUTATION, 120, 1, 100_000),
      attachment: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_ATTACHMENT, 60, 1, 10_000),
      websocket: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET, 600, 1, 100_000),
      websocketConnect: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT, 120, 1, 100_000)
    },
    websocketConnectionCaps: {
      perUser: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER, 20, 1, 1_000),
      perDevice: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_DEVICE, 5, 1, 100)
    },
    shutdown: {
      drainMs: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS, 0, 0, 60_000),
      graceMs: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_SHUTDOWN_GRACE_MS, 10_000, 1_000, 120_000)
    },
    dailyCreationCaps: {
      teamsPerUser: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_DAILY_TEAM_CREATION_CAP, 25, 0, 10_000),
      roomsPerUser: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_DAILY_ROOM_CREATION_CAP, 100, 0, 100_000)
    },
    totalRoomCapPerUser: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER, 500, 1, 100_000)
  };
}

function parseGitHubScopes(value: string | undefined): string[] {
  return parseListEnv(value ?? "read:user public_repo");
}

function parseStorageBackend(value: string | undefined): RelayStorageBackend {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "sqlite") return "sqlite";
  if (normalized === "json") return "json";
  logRelayEvent("warn", "invalid_storage_backend_ignored");
  return "sqlite";
}

function loadRelayEnvFiles() {
  for (const path of relayEnvFileCandidates()) {
    if (!existsSync(path)) continue;
    const parsed = parseEnvFile(readFileSync(path, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] ??= value;
    }
  }
}

function relayEnvFileCandidates(): string[] {
  return Array.from(
    new Set(
      [
        process.env.MULTAIPLAYER_RELAY_ENV_FILE ? resolve(process.env.MULTAIPLAYER_RELAY_ENV_FILE) : "",
        resolve(process.cwd(), "apps/relay/.env"),
        resolve(process.cwd(), ".env"),
        resolve(process.cwd(), "../..", ".env")
      ].filter(Boolean)
    )
  );
}

function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    parsed[key] = normalizeEnvFileValue(rawValue);
  }
  return parsed;
}

function normalizeEnvFileValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "");
}

function parseAllowedOriginEnv(value: string | undefined): string[] {
  const origins = new Set<string>();
  for (const item of parseListEnv(value)) {
    const normalized = normalizeConfiguredOrigin(item);
    if (normalized) {
      origins.add(normalized);
    } else {
      logRelayEvent("warn", "invalid_allowed_origin_ignored");
    }
  }
  return Array.from(origins);
}

function normalizeConfiguredOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!["", "/"].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
    if (["http:", "https:"].includes(parsed.protocol)) return parsed.origin;
    if (!/^[a-z][a-z0-9+.-]*:$/i.test(parsed.protocol) || !parsed.hostname) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function parseListEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntegerEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeSessionPersistenceSecret(value: string | undefined): string | null {
  const secret = value?.trim();
  if (!secret) return null;
  if (secret.length < 32) {
    logRelayEvent("warn", "weak_session_secret_disables_persistence", { minimumCharacters: 32 });
    return null;
  }
  return secret;
}
