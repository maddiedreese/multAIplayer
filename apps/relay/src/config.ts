import { existsSync, readFileSync } from "node:fs";
import { logRelayEvent } from "./observability.js";
import { resolve } from "node:path";

export interface RelayConfig {
  nodeEnv: string;
  port: number;
  dataPath: string;
  minimumDiskHeadroomBytes: number;
  sqliteWalAutoCheckpointPages: number;
  mlsBacklogLimit: number;
  mlsBacklogRetentionDays: number;
  inviteTtlDays: number;
  attachmentBlobTtlDays: number;
  attachmentBlobMaxBytes: number;
  attachmentBlobLiveQuotaBytes: number;
  attachmentBlobUploadBytesPerWindow: number;
  attachmentBlobUploadWindowMs: number;
  jsonBodyLimitBytes: number;
  mlsMessageMaxBytes: number;
  metricsToken: string | null;
  debugEndpointsEnabled: boolean;
  allowedCorsOrigins: string[];
  mutationsRequireAuth: boolean;
  rateLimitsEnabled: boolean;
  trustProxyHeaders: boolean;
  structuredLogsEnabled: boolean;
  exitOnPersistencePoison: boolean;
  rateLimitWindowMs: number;
  trustedNetworkRateLimitMultiplier: number;
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
  registeredDeviceCapPerUser: number;
  retainedAuthSessionCapPerUser: number;
  liveKeyPackageCapPerUser: number;
  keyPackageValidationCapPerUser: number;
  liveInviteCapPerUser: number;
  maxDurableEntries: number;
  maxDurableEntriesPerTeam: number;
  maxMlsBacklogBytes: number;
  maxMlsBacklogBytesPerTeam: number;
  maxMlsBacklogBytesPerRoom: number;
  maxAttachmentBlobBytes: number;
  maxAttachmentBlobBytesPerTeam: number;
}

export function loadRelayConfig(): RelayConfig {
  loadRelayEnvFiles();

  const nodeEnv = process.env.NODE_ENV ?? "development";
  const attachmentBlobMaxBytes = parseIntegerEnv("MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES", 5_000_000, 1, 50_000_000);
  const maxDurableEntries = parseIntegerEnv("MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES", 250_000, 1_000, 10_000_000);
  const jsonBodyLimitBytes = Math.ceil(Math.max(1_000_000, attachmentBlobMaxBytes * 1.5 + 100_000));
  const maxMlsBacklogBytes = parseIntegerEnv(
    "MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES",
    50_000_000,
    1_000_000,
    10_000_000_000
  );
  const maxMlsBacklogBytesPerTeam = parseIntegerEnv(
    "MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_TEAM",
    25_000_000,
    500_000,
    10_000_000_000
  );
  const maxMlsBacklogBytesPerRoom = parseIntegerEnv(
    "MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_ROOM",
    5_000_000,
    100_000,
    1_000_000_000
  );
  const maxAttachmentBlobBytes = parseIntegerEnv(
    "MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES",
    500_000_000,
    attachmentBlobMaxBytes,
    10_000_000_000
  );
  const maxAttachmentBlobBytesPerTeam = parseIntegerEnv(
    "MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES_PER_TEAM",
    250_000_000,
    attachmentBlobMaxBytes,
    10_000_000_000
  );
  const attachmentBlobLiveQuotaBytes = parseIntegerEnv(
    "MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES",
    50_000_000,
    attachmentBlobMaxBytes,
    10_000_000_000
  );
  validateCiphertextByteCeilings({
    attachmentBlobMaxBytes,
    attachmentBlobLiveQuotaBytes,
    maxAttachmentBlobBytes,
    maxAttachmentBlobBytesPerTeam,
    maxMlsBacklogBytes,
    maxMlsBacklogBytesPerTeam,
    maxMlsBacklogBytesPerRoom
  });

  const trustProxyHeadersRequested = parseBooleanEnv("MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS", false);

  return {
    nodeEnv,
    port: parseIntegerEnv("PORT", 4321, 1, 65_535),
    dataPath: resolve(process.env.MULTAIPLAYER_RELAY_DATA_PATH ?? ".multaiplayer/relay-store.sqlite"),
    minimumDiskHeadroomBytes: parseIntegerEnv(
      "MULTAIPLAYER_RELAY_MIN_DISK_HEADROOM_BYTES",
      1_000_000_000,
      100_000_000,
      1_000_000_000_000
    ),
    sqliteWalAutoCheckpointPages: parseIntegerEnv(
      "MULTAIPLAYER_RELAY_SQLITE_WAL_AUTOCHECKPOINT_PAGES",
      1_000,
      50,
      10_000
    ),
    mlsBacklogLimit: parseIntegerEnv("MULTAIPLAYER_RELAY_BACKLOG_LIMIT", 200, 1, 1000),
    mlsBacklogRetentionDays: parseIntegerEnv("MULTAIPLAYER_RELAY_BACKLOG_RETENTION_DAYS", 30, 1, 365),
    inviteTtlDays: parseIntegerEnv("MULTAIPLAYER_RELAY_INVITE_TTL_DAYS", 7, 1, 365),
    attachmentBlobTtlDays: parseIntegerEnv("MULTAIPLAYER_ATTACHMENT_BLOB_TTL_DAYS", 30, 1, 365),
    attachmentBlobMaxBytes,
    attachmentBlobLiveQuotaBytes,
    attachmentBlobUploadBytesPerWindow: parseIntegerEnv(
      "MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW",
      50_000_000,
      attachmentBlobMaxBytes,
      10_000_000_000
    ),
    attachmentBlobUploadWindowMs: parseIntegerEnv(
      "MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_WINDOW_MS",
      3_600_000,
      60_000,
      86_400_000
    ),
    jsonBodyLimitBytes,
    mlsMessageMaxBytes: parseIntegerEnv("MULTAIPLAYER_RELAY_MLS_MESSAGE_MAX_BYTES", 1_000_000, 4096, 5_000_000),
    metricsToken: normalizeMetricsToken(process.env.MULTAIPLAYER_RELAY_METRICS_TOKEN),
    debugEndpointsEnabled: parseBooleanEnv("MULTAIPLAYER_RELAY_DEBUG", false),
    allowedCorsOrigins: parseAllowedOriginEnv(process.env.MULTAIPLAYER_RELAY_ALLOWED_ORIGINS),
    mutationsRequireAuth: !parseBooleanEnv("MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH", false),
    rateLimitsEnabled: parseBooleanEnv("MULTAIPLAYER_RELAY_RATE_LIMITS", true),
    trustProxyHeaders: trustProxyHeadersRequested,
    structuredLogsEnabled: parseBooleanEnv("MULTAIPLAYER_RELAY_STRUCTURED_LOGS", nodeEnv === "production"),
    exitOnPersistencePoison: parseBooleanEnv("MULTAIPLAYER_RELAY_EXIT_ON_PERSISTENCE_POISON", nodeEnv === "production"),
    rateLimitWindowMs: parseIntegerEnv("MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS", 60_000, 1_000, 3_600_000),
    trustedNetworkRateLimitMultiplier: parseIntegerEnv(
      "MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER",
      8,
      1,
      100
    ),
    rateLimitCaps: {
      auth: parseIntegerEnv("MULTAIPLAYER_RELAY_RATE_LIMIT_AUTH", 30, 1, 10_000),
      read: parseIntegerEnv("MULTAIPLAYER_RELAY_RATE_LIMIT_READ", 300, 1, 100_000),
      mutation: parseIntegerEnv("MULTAIPLAYER_RELAY_RATE_LIMIT_MUTATION", 120, 1, 100_000),
      attachment: parseIntegerEnv("MULTAIPLAYER_RELAY_RATE_LIMIT_ATTACHMENT", 60, 1, 10_000),
      websocket: parseIntegerEnv("MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET", 600, 1, 100_000),
      websocketConnect: parseIntegerEnv("MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT", 120, 1, 100_000)
    },
    websocketConnectionCaps: {
      perUser: parseIntegerEnv("MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER", 20, 1, 1_000),
      perDevice: parseIntegerEnv("MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_DEVICE", 5, 1, 100)
    },
    shutdown: {
      drainMs: parseIntegerEnv("MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS", 0, 0, 60_000),
      graceMs: parseIntegerEnv("MULTAIPLAYER_RELAY_SHUTDOWN_GRACE_MS", 10_000, 1_000, 120_000)
    },
    dailyCreationCaps: {
      teamsPerUser: parseIntegerEnv("MULTAIPLAYER_RELAY_DAILY_TEAM_CREATION_CAP", 25, 0, 10_000),
      roomsPerUser: parseIntegerEnv("MULTAIPLAYER_RELAY_DAILY_ROOM_CREATION_CAP", 100, 0, 100_000)
    },
    totalRoomCapPerUser: parseIntegerEnv("MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER", 500, 1, 100_000),
    registeredDeviceCapPerUser: parseIntegerEnv("MULTAIPLAYER_RELAY_REGISTERED_DEVICE_CAP_USER", 25, 1, 10_000),
    retainedAuthSessionCapPerUser: parseIntegerEnv("MULTAIPLAYER_RELAY_RETAINED_AUTH_SESSION_CAP_USER", 20, 1, 1_000),
    liveKeyPackageCapPerUser: parseIntegerEnv("MULTAIPLAYER_RELAY_LIVE_KEY_PACKAGE_CAP_USER", 250, 1, 100_000),
    keyPackageValidationCapPerUser: parseIntegerEnv(
      "MULTAIPLAYER_RELAY_KEY_PACKAGE_VALIDATION_CAP_USER",
      40,
      1,
      10_000
    ),
    liveInviteCapPerUser: parseIntegerEnv("MULTAIPLAYER_RELAY_LIVE_INVITE_CAP_USER", 100, 1, 100_000),
    maxDurableEntries,
    maxDurableEntriesPerTeam: parseIntegerEnv(
      "MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES_PER_TEAM",
      Math.min(25_000, maxDurableEntries - 1),
      100,
      maxDurableEntries - 1
    ),
    // Byte ceilings complement record-count ceilings because ciphertext-bearing
    // records can differ by orders of magnitude in retained memory.
    maxMlsBacklogBytes,
    maxMlsBacklogBytesPerTeam,
    maxMlsBacklogBytesPerRoom,
    maxAttachmentBlobBytes,
    maxAttachmentBlobBytesPerTeam
  };
}

function validateCiphertextByteCeilings(values: {
  attachmentBlobMaxBytes: number;
  attachmentBlobLiveQuotaBytes: number;
  maxAttachmentBlobBytes: number;
  maxAttachmentBlobBytesPerTeam: number;
  maxMlsBacklogBytes: number;
  maxMlsBacklogBytesPerTeam: number;
  maxMlsBacklogBytesPerRoom: number;
}) {
  if (
    values.maxMlsBacklogBytesPerRoom > values.maxMlsBacklogBytesPerTeam ||
    values.maxMlsBacklogBytesPerTeam > values.maxMlsBacklogBytes
  ) {
    throw new Error("MLS backlog byte ceilings must be ordered room <= team <= relay.");
  }
  if (values.maxAttachmentBlobBytesPerTeam > values.maxAttachmentBlobBytes) {
    throw new Error("Attachment byte ceilings must be ordered team <= relay.");
  }
  if (values.attachmentBlobMaxBytes > values.maxAttachmentBlobBytesPerTeam) {
    throw new Error("A single attachment must fit within the per-team attachment byte ceiling.");
  }
  if (values.attachmentBlobLiveQuotaBytes > values.maxAttachmentBlobBytes) {
    throw new Error("Per-user live attachment quota must not exceed the relay attachment byte ceiling.");
  }
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
    if (key === undefined || rawValue === undefined) continue;
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
    if (!normalized) {
      throw new Error(
        "MULTAIPLAYER_RELAY_ALLOWED_ORIGINS entries must be bare HTTP(S) origins or the exact tauri://localhost desktop origin."
      );
    }
    origins.add(normalized);
  }
  return Array.from(origins);
}

function normalizeConfiguredOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!["", "/"].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
    if (parsed.username || parsed.password) return null;
    if (["http:", "https:"].includes(parsed.protocol)) return parsed.origin;
    return parsed.protocol === "tauri:" && parsed.hostname === "localhost" && !parsed.port ? "tauri://localhost" : null;
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

function parseIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!/^-?(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false.`);
}

function normalizeMetricsToken(value: string | undefined): string | null {
  const token = value?.trim();
  if (!token) return null;
  if (token.length < 32) {
    logRelayEvent("warn", "weak_metrics_token_disables_endpoint", { minimumCharacters: 32 });
    return null;
  }
  return token;
}
