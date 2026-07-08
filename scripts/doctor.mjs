import { existsSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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
  checkLocalFile(join("apps", "desktop", "src-tauri", "Cargo.lock"), "Cargo.lock is present for reproducible native builds.");

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

checkOptionalEnv("GITHUB_CLIENT_ID", "GitHub sign-in and PR/Actions flows need a relay GitHub OAuth app.");
checkOptionalEnv("MULTAIPLAYER_RELAY_SESSION_SECRET", "Set at least 32 characters to persist encrypted GitHub sessions across relay restarts.");

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

console.log(productionRelay ? "\nmultAIplayer production relay setup looks ready." : "\nmultAIplayer setup looks ready.");

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

function checkOptionalEnv(name, detail) {
  const value = process.env[name]?.trim();
  checks.push({
    ok: true,
    label: name,
    detail: value ? "configured" : `optional: ${detail}`
  });
}

function checkProductionRelayEnv() {
  const githubClientId = envValue("GITHUB_CLIENT_ID");
  const sessionSecret = envValue("MULTAIPLAYER_RELAY_SESSION_SECRET");
  const allowedOrigins = envValue("MULTAIPLAYER_RELAY_ALLOWED_ORIGINS");
  const requireAuth = envBoolean("MULTAIPLAYER_RELAY_REQUIRE_AUTH", true);
  const debug = envBoolean("MULTAIPLAYER_RELAY_DEBUG", false);
  const seedDemo = envBoolean("MULTAIPLAYER_RELAY_SEED_DEMO", false);
  const rateLimits = envBoolean("MULTAIPLAYER_RELAY_RATE_LIMITS", true);
  const trustProxyHeaders = envBoolean("MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS", false);
  const storage = envValue("MULTAIPLAYER_RELAY_STORAGE") || "json";
  const dataPath = envValue("MULTAIPLAYER_RELAY_DATA_PATH");
  const attachmentBlobMaxBytes = envInteger("MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES", 5_000_000);
  const attachmentBlobLiveQuotaBytes = envInteger("MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES", 250_000_000);
  const attachmentBlobUploadBytes = envInteger("MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW", 100_000_000);
  const websocketConnectionCap = envInteger("MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER", 20);
  const websocketConnectRateLimit = envInteger("MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT", 120);
  const totalRoomCap = envInteger("MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER", 500);
  const allowedOriginErrors = validateAllowedOrigins(allowedOrigins);

  checks.push({
    ok: Boolean(githubClientId),
    label: "production GITHUB_CLIENT_ID",
    detail: githubClientId ? "configured" : "required: production relays need GitHub OAuth configured"
  });
  checks.push({
    ok: sessionSecret.length >= 32,
    label: "production MULTAIPLAYER_RELAY_SESSION_SECRET",
    detail: sessionSecret.length >= 32
      ? "configured with at least 32 characters"
      : "required: use a stable high-entropy value of at least 32 characters"
  });
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
    ok: !seedDemo,
    label: "production MULTAIPLAYER_RELAY_SEED_DEMO",
    detail: seedDemo ? "must not be true for a hosted production relay" : "demo workspace seeding disabled"
  });
  checks.push({
    ok: rateLimits,
    label: "production MULTAIPLAYER_RELAY_RATE_LIMITS",
    detail: rateLimits ? "rate limits enabled" : "must not be false for a hosted production relay"
  });
  checks.push({
    ok: storage === "sqlite",
    label: "production MULTAIPLAYER_RELAY_STORAGE",
    detail: storage === "sqlite"
      ? "sqlite storage configured"
      : storage === "json"
        ? "must be sqlite for a hosted production relay"
        : "must be sqlite"
  });
  checks.push({
    ok: Boolean(dataPath) && !dataPath.startsWith("/tmp/"),
    label: "production MULTAIPLAYER_RELAY_DATA_PATH",
    detail: dataPath
      ? dataPath.startsWith("/tmp/")
        ? "must not point at /tmp for a hosted production relay"
        : "configured"
      : "required: set a persistent relay store path or mounted volume"
  });
  checks.push({
    ok: !trustProxyHeaders,
    label: "production MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS",
    detail: trustProxyHeaders
      ? "only enable after configuring a trusted reverse proxy; leave false by default"
      : "proxy headers not trusted by default"
  });
  checks.push({
    ok: attachmentBlobMaxBytes > 0 && attachmentBlobMaxBytes <= 50_000_000,
    label: "production MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES",
    detail: attachmentBlobMaxBytes > 0 && attachmentBlobMaxBytes <= 50_000_000
      ? `configured at ${attachmentBlobMaxBytes} bytes`
      : "must be between 1 and 50000000 bytes"
  });
  checks.push({
    ok: attachmentBlobLiveQuotaBytes >= attachmentBlobMaxBytes && attachmentBlobLiveQuotaBytes <= 10_000_000_000,
    label: "production MULTAIPLAYER_ATTACHMENT_BLOB_LIVE_QUOTA_BYTES",
    detail: attachmentBlobLiveQuotaBytes >= attachmentBlobMaxBytes && attachmentBlobLiveQuotaBytes <= 10_000_000_000
      ? `configured at ${attachmentBlobLiveQuotaBytes} bytes`
      : "must be at least the blob max and no more than 10000000000 bytes"
  });
  checks.push({
    ok: attachmentBlobUploadBytes >= attachmentBlobMaxBytes && attachmentBlobUploadBytes <= 10_000_000_000,
    label: "production MULTAIPLAYER_ATTACHMENT_BLOB_UPLOAD_BYTES_PER_WINDOW",
    detail: attachmentBlobUploadBytes >= attachmentBlobMaxBytes && attachmentBlobUploadBytes <= 10_000_000_000
      ? `configured at ${attachmentBlobUploadBytes} bytes`
      : "must be at least the blob max and no more than 10000000000 bytes"
  });
  checks.push({
    ok: websocketConnectionCap > 0 && websocketConnectionCap <= 1_000,
    label: "production MULTAIPLAYER_RELAY_WEBSOCKET_CONNECTION_CAP_USER",
    detail: websocketConnectionCap > 0 && websocketConnectionCap <= 1_000
      ? `configured at ${websocketConnectionCap}`
      : "must be between 1 and 1000"
  });
  checks.push({
    ok: websocketConnectRateLimit > 0 && websocketConnectRateLimit <= 100_000,
    label: "production MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET_CONNECT",
    detail: websocketConnectRateLimit > 0 && websocketConnectRateLimit <= 100_000
      ? `configured at ${websocketConnectRateLimit}`
      : "must be between 1 and 100000"
  });
  checks.push({
    ok: totalRoomCap > 0 && totalRoomCap <= 100_000,
    label: "production MULTAIPLAYER_RELAY_TOTAL_ROOM_CAP_USER",
    detail: totalRoomCap > 0 && totalRoomCap <= 100_000
      ? `configured at ${totalRoomCap}`
      : "must be between 1 and 100000"
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
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
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
