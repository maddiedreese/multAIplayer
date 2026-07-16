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
  attachmentBlobTeamLiveQuotaBytes: number;
  attachmentBlobUploadBytesPerWindow: number;
  attachmentBlobUploadWindowMs: number;
  jsonBodyLimitBytes: number;
  mlsMessageMaxBytes: number;
  deletionLedger:
    | {
        backend: "file";
        path: string;
        hmacKey: string;
        protectionSeconds: number;
      }
    | {
        backend: "s3";
        endpoint: string;
        bucket: string;
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
        prefix: string;
        urlStyle: "path" | "virtual-host";
        hmacKey: string;
        protectionSeconds: number;
      }
    | null;
  deletionProtection: "primary_only" | "restore_safe";
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
  liveKeyPackageCapPerUser: number;
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
  const attachmentBlobMaxBytes = parseIntegerEnv(
    process.env.MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES,
    5_000_000,
    1,
    50_000_000
  );
  const maxDurableEntries = parseIntegerEnv(
    process.env.MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES,
    250_000,
    1_000,
    10_000_000
  );
  const jsonBodyLimitBytes = Math.ceil(Math.max(1_000_000, attachmentBlobMaxBytes * 1.5 + 100_000));

  const deletionLedger = parseDeletionLedgerConfig();
  const deletionProtection = parseDeletionProtection(deletionLedger);
  if (deletionProtection === "restore_safe" && !deletionLedger) {
    throw new Error("Restore-safe account deletion requires a complete external deletion ledger configuration.");
  }
  if (nodeEnv === "production" && deletionProtection === "restore_safe" && deletionLedger?.backend === "file") {
    throw new Error(
      "Production relay requires an external S3-compatible deletion ledger; the file backend is development-only."
    );
  }
  const trustProxyHeadersRequested = parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS, false);
  if (
    nodeEnv === "production" &&
    deletionProtection === "restore_safe" &&
    deletionLedger &&
    deletionLedger.protectionSeconds < 7_776_000
  ) {
    throw new Error("Production deletion ledger protection must be at least 7776000 seconds (90 days).");
  }

  return {
    nodeEnv,
    port: parseIntegerEnv(process.env.PORT, 4321, 1, 65_535),
    dataPath: resolve(process.env.MULTAIPLAYER_RELAY_DATA_PATH ?? ".multaiplayer/relay-store.sqlite"),
    minimumDiskHeadroomBytes: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_MIN_DISK_HEADROOM_BYTES,
      1_000_000_000,
      100_000_000,
      1_000_000_000_000
    ),
    sqliteWalAutoCheckpointPages: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_SQLITE_WAL_AUTOCHECKPOINT_PAGES,
      1_000,
      50,
      10_000
    ),
    mlsBacklogLimit: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_BACKLOG_LIMIT, 200, 1, 1000),
    mlsBacklogRetentionDays: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_BACKLOG_RETENTION_DAYS, 30, 1, 365),
    inviteTtlDays: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_INVITE_TTL_DAYS, 7, 1, 365),
    attachmentBlobTtlDays: parseIntegerEnv(process.env.MULTAIPLAYER_ATTACHMENT_BLOB_TTL_DAYS, 30, 1, 365),
    attachmentBlobMaxBytes,
    attachmentBlobLiveQuotaBytes: parseIntegerEnv(
      process.env.MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES,
      250_000_000,
      attachmentBlobMaxBytes,
      10_000_000_000
    ),
    attachmentBlobTeamLiveQuotaBytes: parseIntegerEnv(
      process.env.MULTAIPLAYER_ATTACHMENT_BLOB_TEAM_LIVE_QUOTA_BYTES,
      1_000_000_000,
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
    mlsMessageMaxBytes: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_MLS_MESSAGE_MAX_BYTES,
      1_000_000,
      4096,
      5_000_000
    ),
    deletionLedger,
    deletionProtection,
    metricsToken: normalizeMetricsToken(process.env.MULTAIPLAYER_RELAY_METRICS_TOKEN),
    debugEndpointsEnabled: parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_DEBUG, false),
    allowedCorsOrigins: parseAllowedOriginEnv(process.env.MULTAIPLAYER_RELAY_ALLOWED_ORIGINS),
    mutationsRequireAuth: !parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH, false),
    rateLimitsEnabled: parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMITS, true),
    trustProxyHeaders: trustProxyHeadersRequested,
    structuredLogsEnabled: parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_STRUCTURED_LOGS, nodeEnv === "production"),
    exitOnPersistencePoison: parseBooleanEnv(
      process.env.MULTAIPLAYER_RELAY_EXIT_ON_PERSISTENCE_POISON,
      nodeEnv === "production"
    ),
    rateLimitWindowMs: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000),
    trustedNetworkRateLimitMultiplier: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_TRUSTED_NETWORK_MULTIPLIER,
      8,
      1,
      100
    ),
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
    totalRoomCapPerUser: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER, 500, 1, 100_000),
    liveKeyPackageCapPerUser: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_LIVE_KEY_PACKAGE_CAP_USER,
      250,
      1,
      100_000
    ),
    liveInviteCapPerUser: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_LIVE_INVITE_CAP_USER, 100, 1, 100_000),
    maxDurableEntries,
    maxDurableEntriesPerTeam: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES_PER_TEAM,
      25_000,
      100,
      maxDurableEntries
    ),
    // Byte ceilings complement record-count ceilings because ciphertext-bearing
    // records can differ by orders of magnitude in retained memory.
    maxMlsBacklogBytes: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES,
      100_000_000,
      1_000_000,
      10_000_000_000
    ),
    maxMlsBacklogBytesPerTeam: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_TEAM,
      50_000_000,
      500_000,
      10_000_000_000
    ),
    maxMlsBacklogBytesPerRoom: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_ROOM,
      10_000_000,
      100_000,
      1_000_000_000
    ),
    maxAttachmentBlobBytes: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES,
      500_000_000,
      attachmentBlobMaxBytes,
      10_000_000_000
    ),
    maxAttachmentBlobBytesPerTeam: parseIntegerEnv(
      process.env.MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES_PER_TEAM,
      250_000_000,
      attachmentBlobMaxBytes,
      10_000_000_000
    )
  };
}

function parseDeletionProtection(ledger: RelayConfig["deletionLedger"]): RelayConfig["deletionProtection"] {
  const configured = process.env.MULTAIPLAYER_RELAY_DELETION_PROTECTION?.trim();
  if (configured === undefined || configured === "") return ledger ? "restore_safe" : "primary_only";
  if (configured !== "primary_only" && configured !== "restore_safe") {
    throw new Error("MULTAIPLAYER_RELAY_DELETION_PROTECTION must be primary_only or restore_safe.");
  }
  if (configured === "primary_only" && ledger) {
    throw new Error("Primary-only account deletion must not configure an external deletion ledger.");
  }
  return configured;
}

function parseDeletionLedgerConfig(): RelayConfig["deletionLedger"] {
  const settings = deletionLedgerSettings();
  const { filePath, endpoint, bucket, region, accessKeyId, secretAccessKey, hmacKey } = settings;
  const urlStyle = process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_URL_STYLE?.trim() || "path";
  const protectionSeconds = parseIntegerEnv(
    process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS,
    7_776_000,
    86_400,
    31_536_000
  );
  const configured = [endpoint, bucket, region, accessKeyId, secretAccessKey, hmacKey].filter(Boolean).length;
  if (filePath && configured > 1) throw new Error("Configure exactly one deletion ledger backend.");
  if (filePath) {
    if (hmacKey.length < 32) throw new Error("Deletion ledger HMAC key must contain at least 32 characters.");
    return { backend: "file", path: resolve(filePath), hmacKey, protectionSeconds };
  }
  if (configured === 0) return null;
  if (configured !== 6 || secretAccessKey.length < 32 || hmacKey.length < 32) {
    throw new Error("Deletion ledger configuration is incomplete or uses a key shorter than 32 characters.");
  }
  if (secretAccessKey === hmacKey) {
    throw new Error("Deletion ledger HMAC key must differ from the S3 secret access key.");
  }
  if (urlStyle !== "path" && urlStyle !== "virtual-host") {
    throw new Error("Deletion ledger S3 URL style must be path or virtual-host.");
  }
  return {
    backend: "s3",
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    prefix: process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_PREFIX?.trim() || "relay-deletions/v1",
    urlStyle,
    hmacKey,
    protectionSeconds
  };
}

function deletionLedgerSettings() {
  return {
    filePath: process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH?.trim() ?? "",
    endpoint: process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT?.trim() ?? "",
    bucket: process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET?.trim() ?? "",
    region: process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION?.trim() ?? "",
    accessKeyId: process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID?.trim() ?? "",
    secretAccessKey: process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY?.trim() ?? "",
    hmacKey: process.env.MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY?.trim() ?? ""
  };
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

function normalizeMetricsToken(value: string | undefined): string | null {
  const token = value?.trim();
  if (!token) return null;
  if (token.length < 32) {
    logRelayEvent("warn", "weak_metrics_token_disables_endpoint", { minimumCharacters: 32 });
    return null;
  }
  return token;
}
