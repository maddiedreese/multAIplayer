import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import {
  assessCodexVersion,
  latestContractTestedCodexVersion,
  minimumSupportedCodexVersion
} from "./codex-compatibility.mjs";

const checks = [];

checkNode();
checkNpmVersion();
checkLocalFile("package-lock.json", "package-lock.json is present for npm ci.");
checkLocalFile(".env.example", ".env.example is present for loopback development.");
checkLocalFile(".env", "copy .env.example to .env for the local relay and desktop.");
checkLocalRelayConfiguration();

checkCommand("cargo", ["--version"], "Cargo is required for the Tauri desktop shell.");
checkRustVersion();
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

console.log("\nmultAIplayer development setup looks ready.");

function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    ok: major === 24,
    label: "node",
    detail: `found ${process.version}; Node 24.x is required`
  });
}

function checkRustVersion() {
  const result = spawnSync("rustc", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join(" ").trim();
  const version = output.match(/^rustc\s+(\d+)\.(\d+)\.(\d+)/);
  checks.push({
    ok: result.status === 0 && version?.[1] === "1" && version[2] === "89",
    label: "rustc",
    detail:
      result.status === 0
        ? `${output || "version unavailable"}; Rust 1.89.x is required`
        : "rustc 1.89.x is required for native Tauri tests and builds."
  });
}

function checkNpmVersion() {
  const expected = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))
    .packageManager?.split("@")
    .at(-1);
  const result = spawnSync("npm", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const actual = result.stdout?.trim();
  checks.push({
    ok: result.status === 0 && actual === expected,
    label: "npm",
    detail:
      result.status === 0
        ? `found ${actual}; repository packageManager requires ${expected}`
        : "npm is required to install and run workspace scripts."
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

function checkLocalRelayConfiguration() {
  if (!existsSync(".env")) return;

  const environment = parseEnv(readFileSync(".env", "utf8"));
  const relayHttpUrl = environment.VITE_RELAY_HTTP_URL;
  const relayWebSocketUrl = environment.VITE_RELAY_URL;
  const authDisabled = environment.MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH === "true";
  const localHttp = isLoopbackUrl(relayHttpUrl, ["http:"]);
  const localWebSocket = isLoopbackUrl(relayWebSocketUrl, ["ws:"]);

  if (!localHttp || !localWebSocket) {
    checks.push({
      ok: false,
      label: "local relay configuration",
      detail:
        "doctor supports the loopback development relay; use docs/self-hosting.md to build for a custom HTTPS relay."
    });
    return;
  }

  checks.push({
    ok: authDisabled,
    label: "local relay configuration",
    detail: authDisabled
      ? "loopback relay uses the explicit development-only auth opt-out; GitHub sign-in is intentionally unavailable."
      : "the loopback relay cannot complete native GitHub verification; set MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH=true in .env for local development."
  });
}

function isLoopbackUrl(value, protocols) {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}
