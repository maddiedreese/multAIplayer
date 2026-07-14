#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release, arch } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = "apps/desktop/src-tauri/Cargo.toml";
const cargo = process.env.MULTAIPLAYER_CARGO_BIN?.trim() || "cargo";
const samples = integerArgument("--samples", 50);
const warmups = integerArgument("--warmups", 5);
const concurrency = integerArgument("--concurrency", 1);
const outputPath = stringArgument("--output");
const executable = fileURLToPath(
  new URL(
    `../apps/desktop/src-tauri/target/release/mls-keypackage-validator${platform() === "win32" ? ".exe" : ""}`,
    import.meta.url
  )
);

if (process.argv.includes("--help")) {
  console.log(`Usage: node scripts/benchmark-mls-validator.mjs [options]

Builds a release validator, generates one genuine MLS KeyPackage fixture, then
measures warm child-process invocations. Build and fixture-generation time are
excluded from the measurements.

Options:
  --samples N       measured invocations (default: 50)
  --warmups N       unmeasured warm-up invocations (default: 5)
  --concurrency N   maximum simultaneous child processes (default: 1)
  --output PATH     also write the JSON result to PATH`);
  process.exit(0);
}

await cargoCommand([
  "build",
  "--release",
  "--locked",
  "--manifest-path",
  manifest,
  "-p",
  "mls-core",
  "--bin",
  "mls-keypackage-validator"
]);
const fixtureResult = await cargoCommand([
  "run",
  "--release",
  "--quiet",
  "--locked",
  "--manifest-path",
  manifest,
  "-p",
  "mls-core",
  "--features",
  "test-fixtures",
  "--bin",
  "mls-lifecycle-fixture"
]);
const fixture = JSON.parse(fixtureResult.stdout);
const upload = JSON.stringify({
  key_package: fixture.keyPackage,
  uploader_github_user_id: fixture.nextHost.userId,
  uploader_device_id: fixture.nextHost.deviceId
});

for (let index = 0; index < warmups; index += 1) await invokeValidator(upload);

const durations = [];
const started = performance.now();
let nextSample = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, samples) }, async () => {
    while (nextSample < samples) {
      nextSample += 1;
      const invocationStarted = performance.now();
      await invokeValidator(upload);
      durations.push(performance.now() - invocationStarted);
    }
  })
);
const elapsedMs = performance.now() - started;
durations.sort((left, right) => left - right);
const result = {
  benchmark: "mls-keypackage-validator-child-process",
  samples,
  warmups,
  concurrency,
  elapsedMs: round(elapsedMs),
  throughputPerSecond: round((samples * 1000) / elapsedMs),
  latencyMs: {
    mean: round(durations.reduce((total, value) => total + value, 0) / durations.length),
    p50: round(percentile(durations, 0.5)),
    p95: round(percentile(durations, 0.95)),
    max: round(durations.at(-1))
  },
  machine: {
    platform: platform(),
    release: release(),
    architecture: arch(),
    logicalCpus: cpus().length,
    cpuModel: cpus()[0]?.model ?? "unknown",
    node: process.version
  }
};
const encodedResult = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) {
  const resolvedOutput = resolve(workspaceRoot, outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, encodedResult, "utf8");
}
process.stdout.write(encodedResult);

function integerArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function stringArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return value;
}

async function cargoCommand(args) {
  try {
    return await execFileAsync(cargo, args, { cwd: workspaceRoot, timeout: 300_000, maxBuffer: 4_000_000 });
  } catch (error) {
    if (error?.code === "ENOENT")
      throw new Error(`Rust toolchain required: could not execute ${cargo}`, { cause: error });
    throw error;
  }
}

async function invokeValidator(upload) {
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(executable, [], { cwd: workspaceRoot, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("validator benchmark invocation timed out"));
    }, 5_000);
    let output = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output, "utf8") > 16_384) child.kill();
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`validator exited with ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(upload);
  });
  const validated = JSON.parse(stdout);
  if (validated.github_user_id !== fixture.nextHost.userId || validated.device_id !== fixture.nextHost.deviceId) {
    throw new Error("validator benchmark received an invalid result");
  }
}

function percentile(values, fraction) {
  return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}
