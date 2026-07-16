import { existsSync, statfsSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assessCodexVersion,
  latestContractTestedCodexVersion,
  minimumSupportedCodexVersion
} from "./codex-compatibility.mjs";

const checks = [];
const productionRelay = process.argv.includes("--production-relay");

checkNode();
checkCommand("npm", ["--version"], "npm is required to install and run workspace scripts.");
checkLocalFile("package-lock.json", "package-lock.json is present for npm ci.");
checkLocalFile(".env.example", ".env.example is present for relay/self-host configuration.");
checkOptionalFile(".env", "optional: copy .env.example to .env for local relay/GitHub configuration.");
checkOptionalFile(join("apps", "relay", ".env"), "optional: relay-local env file for package-specific runs.");

if (!productionRelay) {
  checkCommand("cargo", ["--version"], "Cargo is required for the Tauri desktop shell.");
  checkCommand("rustc", ["--version"], "rustc is required for native Tauri tests and builds.");
  checkCodexCompatibility();
  checkLocalFile(
    join("apps", "desktop", "src-tauri", "Cargo.lock"),
    "Cargo.lock is present for reproducible native builds."
  );

  if (platform() === "darwin") {
    checkCommand("xcodebuild", ["-version"], "Xcode command line tools are required for macOS Tauri bundling.");
  } else {
    checks.push({
      ok: true,
      label: "macOS packaging",
      detail: "Skipped: Tauri app/dmg packaging is macOS-only in this alpha."
    });
  }
}

if (productionRelay) {
  checkProductionRelayEnv();
}

let failed = 0;
for (const check of checks) {
  const mark = check.ok ? "ok" : "fail";
  console.log(`[${mark}] ${check.label}: ${check.detail}`);
  if (!check.ok) failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed} required setup check${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log(
  productionRelay ? "\nmultAIplayer production relay setup looks ready." : "\nmultAIplayer setup looks ready."
);

function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    ok: Number.isFinite(major) && major >= 22,
    label: "node",
    detail: `found ${process.version}; Node 22 or newer is expected`
  });
}

function checkCommand(command, args, failureDetail) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join(" ").trim().split(/\s+/).slice(0, 8).join(" ");
  checks.push({
    ok: result.status === 0,
    label: command,
    detail: result.status === 0 ? output || "available" : failureDetail
  });
}

function checkCodexCompatibility() {
  const range = `${minimumSupportedCodexVersion}–${latestContractTestedCodexVersion}`;
  const result = spawnSync("codex", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error?.code === "ENOENT") {
    checks.push({
      ok: true,
      label: "codex compatibility",
      detail: `optional: Codex CLI not found; tested app-server range ${range}`
    });
    return;
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join(" ").trim();
  const compatibility = assessCodexVersion(output);
  const found = compatibility.version ? `found ${compatibility.version}` : output || "version unavailable";
  if (result.status !== 0 || compatibility.status === "unknown") {
    checks.push({
      ok: false,
      label: "codex compatibility",
      detail: `${found}; could not verify against tested app-server range ${range}`
    });
  } else if (compatibility.status === "unsupported_older") {
    checks.push({
      ok: false,
      label: "codex compatibility",
      detail: `${found}; update to ${minimumSupportedCodexVersion} or newer (tested range ${range})`
    });
  } else if (compatibility.status === "unverified_newer") {
    checks.push({
      ok: true,
      label: "codex compatibility",
      detail: `${found}; newer than tested app-server range ${range}`
    });
  } else {
    checks.push({
      ok: true,
      label: "codex compatibility",
      detail: `${found}; supported in tested app-server range ${range}`
    });
  }
}

function checkLocalFile(path, detail) {
  checks.push({
    ok: existsSync(path),
    label: path,
    detail
  });
}

function checkOptionalFile(path, detail) {
  checks.push({
    ok: true,
    label: path,
    detail: existsSync(path) ? "present" : detail
  });
}

function checkProductionRelayEnv() {
  const config = readProductionRelayConfig();
  checkDeletionLedger(config);
  checkCoreRelayConfig(config);
  checkRelayPathsAndProxy(config);
  checkRelayAbuseLimits(config);
}

function readProductionRelayConfig() {
  return {
    deletionLedgerEndpoint: envValue("MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ENDPOINT"),
    deletionLedgerBucket: envValue("MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_BUCKET"),
    deletionLedgerRegion: envValue("MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_REGION"),
    deletionLedgerAccessKey: envValue("MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_ACCESS_KEY_ID"),
    deletionLedgerSecretKey: envValue("MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_SECRET_ACCESS_KEY"),
    deletionLedgerHmacKey: envValue("MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY"),
    deletionLedgerUrlStyle: envValue("MULTAIPLAYER_RELAY_DELETION_LEDGER_S3_URL_STYLE"),
    deletionLedgerProtectionSeconds: envInteger("MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS", 7_776_000),
    allowedOrigins: envValue("MULTAIPLAYER_RELAY_ALLOWED_ORIGINS"),
    requireAuth: envBoolean("MULTAIPLAYER_RELAY_REQUIRE_AUTH", true),
    debug: envBoolean("MULTAIPLAYER_RELAY_DEBUG", false),
    rateLimits: envBoolean("MULTAIPLAYER_RELAY_RATE_LIMITS", true),
    structuredLogs: envBoolean("MULTAIPLAYER_RELAY_STRUCTURED_LOGS", true),
    exitOnPersistencePoison: envBoolean("MULTAIPLAYER_RELAY_EXIT_ON_PERSISTENCE_POISON", true),
    trustProxyHeaders: envBoolean("MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS", false),
    trustedProxyConfigured: envBoolean("MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED", false),
    storage: envValue("MULTAIPLAYER_RELAY_STORAGE") || "sqlite",
    dataPath: envValue("MULTAIPLAYER_RELAY_DATA_PATH"),
    minimumDiskHeadroomBytes: envInteger("MULTAIPLAYER_RELAY_MIN_DISK_HEADROOM_BYTES", 1_000_000_000),
    mlsValidatorPath: envValue("MULTAIPLAYER_MLS_VALIDATOR_PATH"),
    attachmentBlobMaxBytes: envInteger("MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES", 5_000_000),
    attachmentBlobLiveQuotaBytes: envInteger("MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES", 250_000_000),
    attachmentBlobTeamLiveQuotaBytes: envInteger("MULTAIPLAYER_ATTACHMENT_BLOB_TEAM_LIVE_QUOTA_BYTES", 1_000_000_000),
    attachmentBlobUploadBytes: envInteger("MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW", 100_000_000),
    websocketConnectionCap: envInteger("MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER", 20),
    websocketConnectRateLimit: envInteger("MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT", 120),
    totalRoomCap: envInteger("MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER", 500),
    maxDurableEntries: envInteger("MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES", 250_000),
    maxDurableEntriesPerTeam: envInteger("MULTAIPLAYER_RELAY_MAX_DURABLE_ENTRIES_PER_TEAM", 25_000),
    maxMlsBacklogBytes: envInteger("MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES", 100_000_000),
    maxMlsBacklogBytesPerTeam: envInteger("MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_TEAM", 50_000_000),
    maxMlsBacklogBytesPerRoom: envInteger("MULTAIPLAYER_RELAY_MAX_MLS_BACKLOG_BYTES_PER_ROOM", 10_000_000),
    maxAttachmentBlobBytes: envInteger("MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES", 500_000_000),
    maxAttachmentBlobBytesPerTeam: envInteger("MULTAIPLAYER_RELAY_MAX_ATTACHMENT_BLOB_BYTES_PER_TEAM", 250_000_000)
  };
}

function checkDeletionLedger(config) {
  const {
    deletionLedgerEndpoint,
    deletionLedgerBucket,
    deletionLedgerRegion,
    deletionLedgerAccessKey,
    deletionLedgerSecretKey,
    deletionLedgerHmacKey,
    deletionLedgerUrlStyle,
    deletionLedgerProtectionSeconds
  } = config;
  const deletionLedgerEndpointIsHttps = (() => {
    try {
      return new URL(deletionLedgerEndpoint).protocol === "https:";
    } catch {
      return false;
    }
  })();
  checks.push({
    ok:
      deletionLedgerEndpointIsHttps &&
      Boolean(deletionLedgerBucket) &&
      Boolean(deletionLedgerRegion) &&
      Boolean(deletionLedgerAccessKey) &&
      deletionLedgerSecretKey.length >= 32 &&
      deletionLedgerHmacKey.length >= 32 &&
      ["path", "virtual-host"].includes(deletionLedgerUrlStyle) &&
      deletionLedgerProtectionSeconds >= 7_776_000,
    label: "production external deletion ledger",
    detail:
      deletionLedgerEndpointIsHttps &&
      deletionLedgerBucket &&
      deletionLedgerRegion &&
      deletionLedgerAccessKey &&
      deletionLedgerSecretKey.length >= 32 &&
      deletionLedgerHmacKey.length >= 32 &&
      ["path", "virtual-host"].includes(deletionLedgerUrlStyle) &&
      deletionLedgerProtectionSeconds >= 7_776_000
        ? "S3-compatible ledger configured with a protection horizon of at least 90 days"
        : "required: complete HTTPS S3 ledger credentials, separate 32-character HMAC key, explicit URL style, and protection horizon >= 7776000 seconds"
  });
}

function checkCoreRelayConfig(config) {
  const { allowedOrigins, requireAuth, debug, rateLimits, structuredLogs, exitOnPersistencePoison, storage } = config;
  const allowedOriginErrors = validateAllowedOrigins(allowedOrigins);
  checks.push({
    ok: Boolean(allowedOrigins) && allowedOriginErrors.length === 0,
    label: "production MULTAIPLAYER_RELAY_ALLOWED_ORIGINS",
    detail: !allowedOrigins
      ? "required: set exact app origins for credentialed CORS and browser WebSocket upgrades"
      : allowedOriginErrors.length === 0
        ? "configured with exact http(s) origins"
        : `invalid: ${allowedOriginErrors.join("; ")}`
  });
  checks.push({
    ok: requireAuth,
    label: "production MULTAIPLAYER_RELAY_REQUIRE_AUTH",
    detail: requireAuth ? "auth required" : "must not be false for a hosted production relay"
  });
  checks.push({
    ok: !debug,
    label: "production MULTAIPLAYER_RELAY_DEBUG",
    detail: debug ? "must not be true for a hosted production relay" : "debug endpoints disabled"
  });
  checks.push({
    ok: rateLimits,
    label: "production MULTAIPLAYER_RELAY_RATE_LIMITS",
    detail: rateLimits ? "rate limits enabled" : "must not be false for a hosted production relay"
  });
  checks.push({
    ok: structuredLogs && exitOnPersistencePoison,
    label: "production persistence poison recovery",
    detail:
      structuredLogs && exitOnPersistencePoison
        ? "structured poison alert event enabled and process exits for supervised restart"
        : "requires structured logs and MULTAIPLAYER_RELAY_EXIT_ON_PERSISTENCE_POISON=true"
  });
  checks.push({
    ok: storage === "sqlite",
    label: "production MULTAIPLAYER_RELAY_STORAGE",
    detail:
      storage === "sqlite"
        ? "sqlite storage configured"
        : storage === "json"
          ? "must be sqlite for a hosted production relay"
          : "must be sqlite"
  });
}

function checkRelayPathsAndProxy(config) {
  const { dataPath, minimumDiskHeadroomBytes, mlsValidatorPath, trustProxyHeaders, trustedProxyConfigured } = config;
  checks.push({
    ok: Boolean(dataPath) && !dataPath.startsWith("/tmp/"),
    label: "production MULTAIPLAYER_RELAY_DATA_PATH",
    detail: dataPath
      ? dataPath.startsWith("/tmp/")
        ? "must not point at /tmp for a hosted production relay"
        : "configured"
      : "required: set a persistent relay store path or mounted volume"
  });
  let availableBytes = 0;
  try {
    const filesystem = statfsSync(dirname(dataPath));
    availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  } catch {
    // The failed check below explains that the configured volume could not be measured.
  }
  checks.push({
    ok: minimumDiskHeadroomBytes >= 100_000_000 && availableBytes >= minimumDiskHeadroomBytes,
    label: "production SQLite filesystem headroom",
    detail:
      availableBytes >= minimumDiskHeadroomBytes
        ? `${availableBytes} bytes available; minimum ${minimumDiskHeadroomBytes}`
        : `requires at least ${minimumDiskHeadroomBytes} available bytes on the configured data filesystem`
  });
  const validatorProbe = mlsValidatorPath ? spawnSync(mlsValidatorPath, [], { input: "", timeout: 2_000 }) : null;
  checks.push({
    ok: Boolean(mlsValidatorPath) && !validatorProbe?.error,
    label: "production MULTAIPLAYER_MLS_VALIDATOR_PATH",
    detail: !mlsValidatorPath
      ? "required: build and configure mls-keypackage-validator"
      : validatorProbe?.error
        ? "must point to an executable validator"
        : "configured executable"
  });
  checks.push({
    ok: trustProxyHeaders === trustedProxyConfigured,
    label: "production trusted-proxy configuration",
    detail:
      trustProxyHeaders === trustedProxyConfigured
        ? trustProxyHeaders
          ? "forwarded headers enabled with an explicitly configured trusted proxy boundary"
          : "proxy headers not trusted by default"
        : "MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS and MULTAIPLAYER_RELAY_TRUSTED_PROXY_CONFIGURED must match"
  });
}

function checkRelayAbuseLimits(config) {
  const {
    attachmentBlobMaxBytes,
    attachmentBlobLiveQuotaBytes,
    attachmentBlobTeamLiveQuotaBytes,
    attachmentBlobUploadBytes,
    websocketConnectionCap,
    websocketConnectRateLimit,
    totalRoomCap,
    maxDurableEntries,
    maxDurableEntriesPerTeam,
    maxMlsBacklogBytes,
    maxMlsBacklogBytesPerTeam,
    maxMlsBacklogBytesPerRoom,
    maxAttachmentBlobBytes,
    maxAttachmentBlobBytesPerTeam
  } = config;
  checks.push({
    ok: attachmentBlobMaxBytes > 0 && attachmentBlobMaxBytes <= 50_000_000,
    label: "production MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES",
    detail:
      attachmentBlobMaxBytes > 0 && attachmentBlobMaxBytes <= 50_000_000
        ? `configured at ${attachmentBlobMaxBytes} bytes`
        : "must be between 1 and 50000000 bytes"
  });
  checks.push({
    ok:
      attachmentBlobTeamLiveQuotaBytes >= attachmentBlobMaxBytes && attachmentBlobTeamLiveQuotaBytes <= 10_000_000_000,
    label: "production MULTAIPLAYER_ATTACHMENT_BLOB_TEAM_LIVE_QUOTA_BYTES",
    detail:
      attachmentBlobTeamLiveQuotaBytes >= attachmentBlobMaxBytes && attachmentBlobTeamLiveQuotaBytes <= 10_000_000_000
        ? `configured at ${attachmentBlobTeamLiveQuotaBytes} bytes`
        : "must be at least the blob max and no more than 10000000000 bytes"
  });
  checks.push({
    ok: attachmentBlobLiveQuotaBytes >= attachmentBlobMaxBytes && attachmentBlobLiveQuotaBytes <= 10_000_000_000,
    label: "production MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES",
    detail:
      attachmentBlobLiveQuotaBytes >= attachmentBlobMaxBytes && attachmentBlobLiveQuotaBytes <= 10_000_000_000
        ? `configured at ${attachmentBlobLiveQuotaBytes} bytes`
        : "must be at least the blob max and no more than 10000000000 bytes"
  });
  checks.push({
    ok: attachmentBlobUploadBytes >= attachmentBlobMaxBytes && attachmentBlobUploadBytes <= 10_000_000_000,
    label: "production MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW",
    detail:
      attachmentBlobUploadBytes >= attachmentBlobMaxBytes && attachmentBlobUploadBytes <= 10_000_000_000
        ? `configured at ${attachmentBlobUploadBytes} bytes`
        : "must be at least the blob max and no more than 10000000000 bytes"
  });
  checks.push({
    ok: websocketConnectionCap > 0 && websocketConnectionCap <= 1_000,
    label: "production MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER",
    detail:
      websocketConnectionCap > 0 && websocketConnectionCap <= 1_000
        ? `configured at ${websocketConnectionCap}`
        : "must be between 1 and 1000"
  });
  checks.push({
    ok: websocketConnectRateLimit > 0 && websocketConnectRateLimit <= 100_000,
    label: "production MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT",
    detail:
      websocketConnectRateLimit > 0 && websocketConnectRateLimit <= 100_000
        ? `configured at ${websocketConnectRateLimit}`
        : "must be between 1 and 100000"
  });
  checks.push({
    ok: totalRoomCap > 0 && totalRoomCap <= 100_000,
    label: "production MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER",
    detail:
      totalRoomCap > 0 && totalRoomCap <= 100_000 ? `configured at ${totalRoomCap}` : "must be between 1 and 100000"
  });
  checks.push({
    ok: maxDurableEntries >= 1_000 && maxDurableEntriesPerTeam >= 100 && maxDurableEntriesPerTeam < maxDurableEntries,
    label: "production per-team durable-entry fairness",
    detail:
      maxDurableEntriesPerTeam < maxDurableEntries
        ? `per-team ceiling ${maxDurableEntriesPerTeam}; global ceiling ${maxDurableEntries}`
        : "per-team ceiling must be lower than the global durable-entry ceiling"
  });
  checks.push({
    ok: maxMlsBacklogBytesPerRoom <= maxMlsBacklogBytesPerTeam && maxMlsBacklogBytesPerTeam <= maxMlsBacklogBytes,
    label: "production MLS retained-byte ceiling hierarchy",
    detail:
      maxMlsBacklogBytesPerRoom <= maxMlsBacklogBytesPerTeam && maxMlsBacklogBytesPerTeam <= maxMlsBacklogBytes
        ? `room ${maxMlsBacklogBytesPerRoom}; team ${maxMlsBacklogBytesPerTeam}; relay ${maxMlsBacklogBytes}`
        : "room ceiling must not exceed team, and team must not exceed relay"
  });
  checks.push({
    ok: maxAttachmentBlobBytesPerTeam <= maxAttachmentBlobBytes,
    label: "production attachment retained-byte ceiling hierarchy",
    detail:
      maxAttachmentBlobBytesPerTeam <= maxAttachmentBlobBytes
        ? `team ${maxAttachmentBlobBytesPerTeam}; relay ${maxAttachmentBlobBytes}`
        : "team ceiling must not exceed relay"
  });
}

function envValue(name) {
  return process.env[name]?.trim() ?? "";
}

function envBoolean(name, fallback) {
  const value = envValue(name).toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function envInteger(name, fallback) {
  const raw = envValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : NaN;
}

function validateAllowedOrigins(value) {
  if (!value) return [];
  const errors = [];
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) return ["no origins were provided"];
  for (const origin of origins) {
    if (origin === "*") {
      errors.push("* is not allowed with credentialed CORS");
      continue;
    }
    try {
      const parsed = new URL(origin);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        errors.push(`${origin} must use http or https`);
      }
      if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
        errors.push(`${origin} must be a bare origin without path, query, or hash`);
      }
      if (parsed.username || parsed.password) {
        errors.push(`${origin} must not include credentials`);
      }
    } catch {
      errors.push(`${origin} is not a valid URL origin`);
    }
  }
  return errors;
}
