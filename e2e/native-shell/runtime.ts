import { spawn, type ChildProcess } from "node:child_process";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

interface RuntimeOptions {
  root: string;
  appBinary: string;
  operationTimeoutMs?: number;
}

interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  detached?: boolean;
  persistent?: boolean;
}

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class NativeShellRuntime {
  readonly operationTimeoutMs: number;
  readonly #root: string;
  readonly #appBinary: string;
  readonly #processes: ChildProcess[] = [];

  constructor({ root, appBinary, operationTimeoutMs = 15_000 }: RuntimeOptions) {
    this.#root = root;
    this.#appBinary = appBinary;
    this.operationTimeoutMs = operationTimeoutMs;
  }

  spawn(command: string, args: string[], options: ProcessOptions = {}) {
    const persistent = options.persistent ?? true;
    const child = spawn(command, args, {
      cwd: options.cwd ?? this.#root,
      env: { ...process.env, ...options.env },
      detached: options.detached ?? (persistent && process.platform !== "win32"),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const label = `${command} ${args.join(" ")}`;
    child.stdout?.on("data", (chunk) => process.stdout.write(`[native-e2e] ${chunk}`));
    child.stderr?.on("data", (chunk) => process.stderr.write(`[native-e2e] ${chunk}`));
    child.once("error", (error) => console.error(`[native-e2e] ${label}: ${error.message}`));
    if (persistent) this.#processes.push(child);
    return child;
  }

  async run(command: string, args: string[], options: RunOptions = {}) {
    const { timeoutMs = 8 * 60_000, ...spawnOptions } = options;
    const detached = process.platform !== "win32";
    const child = this.spawn(command, args, { ...spawnOptions, detached, persistent: false });
    const terminate = (signal: NodeJS.Signals) => {
      try {
        if (detached && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH")
          console.warn(`[native-e2e] failed to send ${signal} to ${command}: ${String(error)}`);
      }
    };
    const code = await new Promise<number>((resolveCode, reject) => {
      let timedOut = false;
      let forceKillTimer: NodeJS.Timeout | undefined;
      const timeout = setTimeout(() => {
        timedOut = true;
        terminate("SIGTERM");
        forceKillTimer = setTimeout(() => {
          terminate("SIGKILL");
          child.stdout?.destroy();
          child.stderr?.destroy();
          reject(new Error(`${command} exceeded its ${timeoutMs}ms timeout`));
        }, 2_000);
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timeout);
        if (!timedOut) {
          if (forceKillTimer) clearTimeout(forceKillTimer);
          reject(error);
        }
      });
      child.once("exit", (exitCode, signal) => {
        clearTimeout(timeout);
        if (timedOut) return;
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (signal) reject(new Error(`${command} exited from ${signal}`));
        else resolveCode(exitCode ?? 1);
      });
    });
    if (code !== 0) throw new Error(`${command} exited with code ${code}`);
  }

  async bestEffort(label: string, operation: Promise<unknown>, timeoutMs = this.operationTimeoutMs) {
    await this.withTimeout(operation, timeoutMs, label).catch((error) => {
      console.warn(`[native-e2e] ${label} failed: ${String(error)}`);
    });
  }

  async withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} exceeded its ${timeoutMs}ms timeout`)), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async freePorts(count: number) {
    const ports = new Set<number>();
    while (ports.size < count) ports.add(await freePort());
    return [...ports];
  }

  async waitForUrl(url: string, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const remainingMs = Math.max(1, deadline - Date.now());
        const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(2_000, remainingMs)) });
        if (response.ok) return;
      } catch (error) {
        lastError = error;
      }
      await delay(250);
    }
    throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
  }

  async waitForDriver(port: number) {
    await this.waitForUrl(`http://127.0.0.1:${port}/status`, 30_000);
  }

  async makeIsolatedLauncher(tempRoot: string, name: string) {
    const profile = join(tempRoot, name);
    const launcher = join(tempRoot, `launch-${name}`);
    await writeFile(
      launcher,
      `#!/usr/bin/env bash
set -euo pipefail
export XDG_DATA_HOME=${JSON.stringify(join(profile, "data"))}
export XDG_CONFIG_HOME=${JSON.stringify(join(profile, "config"))}
export XDG_CACHE_HOME=${JSON.stringify(join(profile, "cache"))}
export XDG_RUNTIME_DIR=${JSON.stringify(join(profile, "runtime"))}
export HOME=${JSON.stringify(join(profile, "home"))}
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR" "$HOME"
chmod 700 "$XDG_RUNTIME_DIR"
export MULTAIPLAYER_E2E_APP_BINARY=${JSON.stringify(this.#appBinary)}
export MULTAIPLAYER_E2E_APP_PID_FILE=${JSON.stringify(join(tempRoot, `${name}-app.pid`))}
exec dbus-run-session -- bash -euo pipefail -c '
  printf "%s\\n" native-e2e | gnome-keyring-daemon --unlock --components=secrets >/dev/null
  printf "%s\\n" "$$" > "$MULTAIPLAYER_E2E_APP_PID_FILE"
  exec "$MULTAIPLAYER_E2E_APP_BINARY"
'
`,
      "utf8"
    );
    await chmod(launcher, 0o700);
    return launcher;
  }

  async killIsolatedApp(tempRoot: string, name: string) {
    const pidPath = join(tempRoot, `${name}-app.pid`);
    const pid = Number((await readFile(pidPath, "utf8")).trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`invalid ${name} native app pid in ${pidPath}`);
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      await delay(50);
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
        throw error;
      }
    }
    throw new Error(`${name} native app process ${pid} remained alive after SIGKILL`);
  }

  async stopProcesses() {
    await Promise.all(this.#processes.reverse().map((child) => stopProcess(child)));
  }

  async cleanupProfiles(tempRoot: string, names: string[]) {
    await Promise.all(names.map((name) => unmountRuntimeDocumentPortal(join(tempRoot, `${name}/runtime/doc`))));
    await this.withTimeout(
      rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }),
      10_000,
      "isolated profile cleanup"
    ).catch((error) => console.warn(`[native-e2e] isolated profile cleanup deferred: ${String(error)}`));
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate a TCP port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

async function stopProcess(child: ChildProcess) {
  child.stdout?.removeAllListeners("data");
  child.stderr?.removeAllListeners("data");
  child.stdout?.destroy();
  child.stderr?.destroy();

  if (process.platform !== "win32" && child.pid) {
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        console.warn(`[native-e2e] failed to send ${signal} to process group ${child.pid}: ${String(error)}`);
        return false;
      }
    };
    if (!signalGroup("SIGTERM")) return;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      await delay(100);
      try {
        process.kill(-child.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      }
    }
    signalGroup("SIGKILL");
    return;
  }

  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    delay(2_000).then(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    })
  ]);
}

async function unmountRuntimeDocumentPortal(path: string) {
  for (const [command, args] of [
    ["fusermount3", ["-uz", path]],
    ["fusermount", ["-uz", path]],
    ["umount", ["-l", path]]
  ] as const) {
    const child = spawn(command, args, { stdio: "ignore" });
    const code = await new Promise<number>((resolveCode) => {
      const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
      child.once("error", () => {
        clearTimeout(timeout);
        resolveCode(1);
      });
      child.once("exit", (exitCode) => {
        clearTimeout(timeout);
        resolveCode(exitCode ?? 1);
      });
    });
    if (code === 0) return;
  }
}
