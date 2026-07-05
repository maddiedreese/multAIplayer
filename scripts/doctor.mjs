import { existsSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const checks = [];
const productionRelay = process.argv.includes("--production-relay");

checkNode();
checkCommand("npm", ["--version"], "npm is required to install and run workspace scripts.");
checkCommand("cargo", ["--version"], "Cargo is required for the Tauri desktop shell.");
checkCommand("rustc", ["--version"], "rustc is required for native Tauri tests and builds.");
checkLocalFile("package-lock.json", "package-lock.json is present for npm ci.");
checkLocalFile(join("apps", "desktop", "src-tauri", "Cargo.lock"), "Cargo.lock is present for reproducible native builds.");
checkLocalFile(".env.example", ".env.example is present for relay/self-host configuration.");
checkOptionalFile(".env", "optional: copy .env.example to .env for local relay/GitHub configuration.");
checkOptionalFile(join("apps", "relay", ".env"), "optional: relay-local env file for package-specific runs.");

if (platform() === "darwin") {
  checkCommand("xcodebuild", ["-version"], "Xcode command line tools are required for macOS Tauri bundling.");
} else {
  checks.push({
    ok: true,
    label: "macOS packaging",
    detail: "Skipped: Tauri app/dmg packaging is macOS-only in this alpha."
  });
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
    ok: Boolean(allowedOrigins),
    label: "production MULTAIPLAYER_RELAY_ALLOWED_ORIGINS",
    detail: allowedOrigins
      ? "configured"
      : "required: set exact app origins for credentialed CORS and browser WebSocket upgrades"
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
