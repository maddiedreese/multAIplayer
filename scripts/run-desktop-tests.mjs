import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const desktopRoot = join(repositoryRoot, "apps", "desktop");
const smokeTest = "test/appSmoke.test.ts";
const repositoryId = createHash("sha256").update(repositoryRoot).digest("hex").slice(0, 12);
const lockPath = join(tmpdir(), `multaiplayer-${basename(repositoryRoot)}-${repositoryId}-desktop-smoke.lock`);
const smokeOnly = process.argv.includes("--smoke-only");
let activeChild = null;
let activeLockToken = null;
let shutdownTimer = null;
let shutdownExitCode = null;

function positiveIntegerFromEnvironment(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received ${JSON.stringify(raw)}`);
  }
  return value;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireSmokeLock(token) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, runnerPid: process.pid, token, startedAt: new Date().toISOString() }));
      closeSync(descriptor);
      descriptor = undefined;
      return;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (error?.code !== "EEXIST") throw error;

      let owner;
      try {
        owner = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch {
        owner = null;
      }
      if (processIsAlive(owner?.pid)) {
        throw new Error(`Desktop smoke test is already active in process ${owner.pid}. Refusing to launch another copy.`);
      }
      try {
        unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
    }
  }
  throw new Error("Unable to acquire the desktop smoke-test lock");
}

function releaseSmokeLock(token) {
  try {
    const owner = JSON.parse(readFileSync(lockPath, "utf8"));
    if (owner?.runnerPid === process.pid && owner?.token === token) unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") console.error(`Failed to release ${lockPath}:`, error);
  }
}

function updateSmokeLockOwner(token, childPid) {
  const owner = JSON.parse(readFileSync(lockPath, "utf8"));
  if (owner?.runnerPid !== process.pid || owner?.token !== token) {
    throw new Error("Desktop smoke-test lock ownership changed before the worker started");
  }
  writeFileSync(lockPath, JSON.stringify({ ...owner, pid: childPid, workerStartedAt: new Date().toISOString() }), { mode: 0o600 });
}

function terminateProcessGroup(child, signal) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") console.error(`Failed to send ${signal} to test process group ${child.pid}:`, error);
  }
}

function runTsxTests(files, { label, timeoutMs, environment = {}, onSpawn }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [
      resolve(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      "--test",
      ...files
    ], {
      cwd: desktopRoot,
      detached: process.platform !== "win32",
      env: { ...process.env, ...environment },
      stdio: "inherit"
    });
    activeChild = child;
    let timedOut = false;
    let forceKillTimer;
    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`${label} exceeded its ${timeoutMs}ms hard timeout; terminating process group ${child.pid}.`);
      terminateProcessGroup(child, "SIGTERM");
      forceKillTimer = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 3_000);
      forceKillTimer.unref();
    }, timeoutMs);
    timeout.unref();

    child.once("error", (error) => {
      if (activeChild === child) activeChild = null;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      if (activeChild === child) activeChild = null;
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
      }
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (timedOut) {
        rejectRun(new Error(`${label} was terminated after exceeding ${timeoutMs}ms`));
      } else if (code !== 0) {
        rejectRun(new Error(`${label} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
      } else {
        resolveRun();
      }
    });
    try {
      onSpawn?.(child);
    } catch (error) {
      clearTimeout(timeout);
      terminateProcessGroup(child, "SIGTERM");
      rejectRun(error);
    }
  });
}

async function main() {
  const unitTimeoutMs = positiveIntegerFromEnvironment("MULTAIPLAYER_DESKTOP_TEST_TIMEOUT_MS", 180_000);
  const smokeTimeoutMs = positiveIntegerFromEnvironment("MULTAIPLAYER_SMOKE_TIMEOUT_MS", 30_000);
  const allTests = readdirSync(join(desktopRoot, "test"))
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => `test/${name}`);
  const unitTests = allTests.filter((name) => name !== smokeTest);

  if (!smokeOnly) await runTsxTests(unitTests, { label: "Desktop unit tests", timeoutMs: unitTimeoutMs });

  const lockToken = randomUUID();
  acquireSmokeLock(lockToken);
  activeLockToken = lockToken;
  try {
    await runTsxTests([smokeTest], {
      label: "Desktop App smoke test",
      timeoutMs: smokeTimeoutMs,
      environment: { MULTAIPLAYER_SMOKE_WATCHDOG: lockToken },
      onSpawn: (child) => updateSmokeLockOwner(lockToken, child.pid)
    });
  } finally {
    releaseSmokeLock(lockToken);
    if (activeLockToken === lockToken) activeLockToken = null;
  }
}

const shutdownSignals = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
for (const [signal, number] of Object.entries(shutdownSignals)) {
  process.once(signal, () => {
    if (shutdownExitCode !== null) return;
    shutdownExitCode = 128 + number;
    process.exitCode = shutdownExitCode;
    terminateProcessGroup(activeChild, "SIGTERM");
    shutdownTimer = setTimeout(() => {
      terminateProcessGroup(activeChild, "SIGKILL");
      if (activeLockToken) releaseSmokeLock(activeLockToken);
      process.exit(shutdownExitCode);
    }, 3_000);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = shutdownExitCode ?? 1;
});
