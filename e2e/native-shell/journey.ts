import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { multiremote, type Browser } from "webdriverio";
import { startRelay, type StoredRelayStateFixture } from "../../apps/relay/test/support/relay.js";

const root = resolve(import.meta.dirname, "../..");
const desktopRoot = join(root, "apps/desktop");
const appBinary = join(desktopRoot, "src-tauri/target/debug/multaiplayer");
const validatorBinary = join(desktopRoot, "src-tauri/target/debug/mls-keypackage-validator");
const cargoBuildOnly = join(root, "e2e/native-shell/cargo-build-only.sh");
const frontendUrl = "http://127.0.0.1:1420";
const roomName = `Native integration ${Date.now()}`;
const messageText = `real MLS message ${Date.now()}`;
const processes: ChildProcess[] = [];
const webdriverOperationTimeoutMs = 15_000;

interface Identity {
  id: string;
  login: string;
  name: string;
}

const hostIdentity: Identity = { id: "github:native-host", login: "native-host", name: "Native Host" };
const guestIdentity: Identity = { id: "github:native-guest", login: "native-guest", name: "Native Guest" };

function workspace(): StoredRelayStateFixture {
  const joinedAt = new Date().toISOString();
  return {
    version: 1,
    savedAt: joinedAt,
    teams: [{ id: "team-native-e2e", name: "Native Integration Team", members: 2 }],
    rooms: [],
    invites: [],
    teamMembers: [
      {
        teamId: "team-native-e2e",
        members: [
          { userId: hostIdentity.id, role: "owner", joinedAt },
          { userId: guestIdentity.id, role: "member", joinedAt }
        ]
      }
    ],
    devices: [],
    encryptedBacklog: []
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

async function freePorts(count: number) {
  const ports = new Set<number>();
  while (ports.size < count) ports.add(await freePort());
  return [...ports];
}

function spawnProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; detached?: boolean; persistent?: boolean } = {}
) {
  const persistent = options.persistent ?? true;
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    detached: options.detached ?? (persistent && process.platform !== "win32"),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const label = `${command} ${args.join(" ")}`;
  child.stdout?.on("data", (chunk) => process.stdout.write(`[native-e2e] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[native-e2e] ${chunk}`));
  child.once("error", (error) => console.error(`[native-e2e] ${label}: ${error.message}`));
  if (persistent) processes.push(child);
  return child;
}

function stage(message: string) {
  console.log(`[native-e2e] ${new Date().toISOString()} ${message}`);
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
) {
  const { timeoutMs = 8 * 60_000, ...spawnOptions } = options;
  const detached = process.platform !== "win32";
  const child = spawnProcess(command, args, { ...spawnOptions, detached, persistent: false });
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
      forceKillTimer = setTimeout(() => terminate("SIGKILL"), 2_000);
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(error);
    });
    child.once("exit", (exitCode, signal) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (timedOut) reject(new Error(`${command} exceeded its ${timeoutMs}ms timeout`));
      else if (signal) reject(new Error(`${command} exited from ${signal}`));
      else resolveCode(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`${command} exited with code ${code}`);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
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

async function bestEffort(label: string, operation: Promise<unknown>, timeoutMs = webdriverOperationTimeoutMs) {
  await withTimeout(operation, timeoutMs, label).catch((error) => {
    console.warn(`[native-e2e] ${label} failed: ${String(error)}`);
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

async function waitForUrl(url: string, timeoutMs = 120_000) {
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

async function waitForDriver(port: number) {
  await waitForUrl(`http://127.0.0.1:${port}/status`, 30_000);
}

async function makeIsolatedLauncher(tempRoot: string, name: string) {
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
export MULTAIPLAYER_E2E_APP_BINARY=${JSON.stringify(appBinary)}
exec dbus-run-session -- bash -euo pipefail -c '
  printf "%s\\n" native-e2e | gnome-keyring-daemon --unlock --components=secrets >/dev/null
  exec "$MULTAIPLAYER_E2E_APP_BINARY"
'
`,
    "utf8"
  );
  await chmod(launcher, 0o700);
  return launcher;
}

async function authenticate(browser: Browser, relayBaseUrl: string, identity: Identity) {
  const result = await browser.executeAsync(
    (baseUrl, user, done) => {
      fetch(`${baseUrl}/debug/auth-session`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(user)
      })
        .then((response) => done({ status: response.status }))
        .catch((error) => done({ error: String(error) }));
    },
    relayBaseUrl,
    identity
  );
  assert.deepEqual(result, { status: 201 }, `debug authentication failed for ${identity.id}`);
  await browser.refresh();
  await visible(browser, ".profile-card strong");
  await browser.waitUntil(
    () =>
      browser.execute(
        (expectedName) => document.querySelector(".profile-card strong")?.textContent?.trim() === expectedName,
        identity.name
      ),
    {
      timeout: 30_000,
      timeoutMsg: `authenticated profile did not resolve for ${identity.id}`
    }
  );
}

async function visible(browser: Browser, selector: string, timeout = 30_000) {
  const element = await browser.$(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

async function createRoom(host: Browser) {
  await (await visible(host, 'button[aria-label="New room"]')).click();
  await (await visible(host, 'input[placeholder="Room name"]')).setValue(roomName);
  const projectPath = await host.$(".room-create-form .path-create-row input");
  await projectPath.setValue(root);
  await (await visible(host, "button=Create room")).click();
  const title = await visible(host, 'input[aria-label="Room title"]', 60_000);
  await title.waitUntil(async () => (await title.getValue()) === roomName, {
    timeout: 60_000,
    timeoutMsg: "native host did not create the MLS room"
  });
  const hostButton = await visible(host, "button=Host");
  assert.equal(await hostButton.isEnabled(), true, "new room did not enter offline host-bootstrap state");
  await hostButton.click();
  const handoffButton = await visible(host, "button=Handoff");
  await handoffButton.waitUntil(() => handoffButton.isEnabled(), {
    timeout: 60_000,
    timeoutMsg: "host did not create the native MLS group and bootstrap relay authority"
  });
}

async function selectRoom(browser: Browser) {
  const room = await visible(
    browser,
    `//button[contains(concat(" ", normalize-space(@class), " "), " room-button ") and contains(., "${roomName}")]`,
    60_000
  );
  await room.click();
  const title = await visible(browser, 'input[aria-label="Room title"]');
  await title.waitUntil(async () => (await title.getValue()) === roomName, { timeout: 30_000 });
}

async function openRoomInspector(browser: Browser) {
  const tools = await visible(browser, 'nav[aria-label="Room tools"]');
  await (await tools.$("button=Room")).click();
}

async function inviteAndApprove(host: Browser, guest: Browser) {
  await openRoomInspector(host);
  await (await visible(host, "button=Copy room invite")).click();
  await visible(host, ".invite-link");
  const invite = await host.execute(() => document.querySelector(".invite-link")?.textContent?.trim() ?? "");
  assert.match(invite, /^http:\/\/127\.0\.0\.1:1420\/?\?invite=/);
  assert.match(invite, /#multaiplayerJoin=/);

  await selectRoom(guest);
  await openRoomInspector(guest);
  await (await visible(guest, 'textarea[placeholder="Paste a multAIplayer invite..."]')).setValue(invite);
  await (await visible(guest, "button=Import invite")).click();
  await guest.waitUntil(
    () =>
      guest.execute(() =>
        (document.querySelector(".invite-panel .workflow-message")?.textContent ?? "").includes("Requested access")
      ),
    { timeout: 60_000, timeoutMsg: "guest did not persist the protected invite request" }
  );

  await host.refresh();
  await visible(host, ".profile-card strong");
  await selectRoom(host);
  await openRoomInspector(host);
  const request = await visible(host, ".invite-panel .terminal-request.pending", 60_000);
  const requestText = await host.execute(
    () => document.querySelector(".invite-panel .terminal-request.pending")?.textContent ?? ""
  );
  assert.ok(requestText.includes(guestIdentity.id), "host did not receive the guest's authenticated identity");
  assert.match(requestText, /Capability-authenticated MLS KeyPackage request/);
  const approve = await request.$("button");
  await approve.waitForEnabled({ timeout: 60_000, timeoutMsg: "host invite approval did not become available" });
  const previousHostMessage = await host.execute(
    () => document.querySelector(".invite-panel .workflow-message")?.textContent ?? ""
  );
  const previousGuestMessage = await guest.execute(
    () => document.querySelector(".invite-panel .workflow-message")?.textContent ?? ""
  );
  await approve.click();
  await host.waitUntil(
    () =>
      host.execute((previousMessage) => {
        const approved = Boolean(document.querySelector(".invite-panel .terminal-request.approved"));
        const message = document.querySelector(".invite-panel .workflow-message")?.textContent ?? "";
        return approved || (message.length > 0 && message !== previousMessage);
      }, previousHostMessage),
    { timeout: 60_000, timeoutMsg: "host invite approval produced neither a decision nor an error" }
  );
  const hostDecision = await host.execute(() => ({
    approved: Boolean(document.querySelector(".invite-panel .terminal-request.approved")),
    message: document.querySelector(".invite-panel .workflow-message")?.textContent ?? ""
  }));
  assert.equal(hostDecision.approved, true, `host invite approval failed: ${hostDecision.message}`);
  await guest.waitUntil(
    () =>
      guest.execute((previousMessage) => {
        const message = document.querySelector(".invite-panel .workflow-message")?.textContent ?? "";
        return message.length > 0 && message !== previousMessage;
      }, previousGuestMessage),
    { timeout: 60_000, timeoutMsg: "guest received neither an invite decision nor a Welcome-processing error" }
  );
  const guestDecision = await guest.execute(
    () => document.querySelector(".invite-panel .workflow-message")?.textContent ?? ""
  );
  assert.match(guestDecision, /approved|unlocked|joined/i, `guest MLS Welcome processing failed: ${guestDecision}`);
}

async function sendAndReceive(sender: Browser, receiver: Browser, text: string) {
  const composer = await visible(sender, 'textarea[placeholder^="Message the room"]');
  await composer.setValue(text);
  await (await visible(sender, 'button[aria-label="Send message"]')).click();
  await visible(receiver, ".chat-scroll", 60_000);
  await receiver.waitUntil(
    () =>
      receiver.execute(
        (expectedText) =>
          [...document.querySelectorAll(".chat-scroll article.message .bubble > p")].some(
            (element) => element.textContent === expectedText
          ),
        text
      ),
    { timeout: 60_000, timeoutMsg: `receiver did not display the encrypted message: ${text}` }
  );
}

async function handoff(host: Browser, guest: Browser) {
  await (await visible(host, "button=Handoff")).click();
  const available = await visible(guest, ".handoff-row.available", 60_000);
  await (await available.$("button=Request handoff")).click();
  await visible(guest, ".handoff-row.requested", 60_000);
  const requested = await visible(host, ".handoff-row.requested", 60_000);
  await (await requested.$("button=Approve candidate")).click();
  try {
    await visible(guest, ".handoff-row.accepted", 60_000);
    await guest.waitUntil(
      async () =>
        (await (await guest.$("button=Handoff")).isEnabled()) && !(await (await host.$("button=Handoff")).isEnabled()),
      {
        timeout: 60_000,
        interval: 250,
        timeoutMsg: "accepted handoff did not converge on successor-only host controls"
      }
    );
  } catch (error) {
    const diagnostics = await Promise.all([
      boundedHandoffDiagnostics(host, "host"),
      boundedHandoffDiagnostics(guest, "guest")
    ]);
    throw new Error(
      `${String(error)}\nHost UI: ${JSON.stringify(diagnostics[0])}\nGuest UI: ${JSON.stringify(diagnostics[1])}`
    );
  }
}

async function boundedHandoffDiagnostics(browser: Browser, client: string) {
  return withTimeout(handoffDiagnostics(browser), webdriverOperationTimeoutMs, `${client} handoff diagnostics`).catch(
    (error) => ({ error: String(error) })
  );
}

async function handoffDiagnostics(browser: Browser) {
  return browser.execute(() => {
    const handoffButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Handoff"
    );
    return {
      handoffEnabled: handoffButton ? !handoffButton.disabled : null,
      handoffRows: [...document.querySelectorAll(".handoff-row")].map((row) => ({
        className: row.className,
        text: row.textContent?.trim() ?? ""
      })),
      workflowMessages: [...document.querySelectorAll(".workflow-message")].map((message) =>
        message.textContent?.trim()
      )
    };
  });
}

async function assertRelayHost(guest: Browser, relayBaseUrl: string) {
  const result = await guest.executeAsync(
    (baseUrl, targetRoomName, done) => {
      fetch(`${baseUrl}/teams`, { credentials: "include" })
        .then(async (response) => {
          const body = (await response.json()) as {
            rooms?: Array<{ name?: string; hostUserId?: string }>;
          };
          done({ status: response.status, room: body.rooms?.find((candidate) => candidate.name === targetRoomName) });
        })
        .catch((error) => done({ error: String(error) }));
    },
    relayBaseUrl,
    roomName
  );
  assert.equal((result as { status?: number }).status, 200);
  assert.equal((result as { room?: { hostUserId?: string } }).room?.hostUserId, guestIdentity.id);
}

async function main() {
  if (process.platform !== "linux") throw new Error("Native shell E2E requires Linux WebKitWebDriver and Xvfb");
  const tempRoot = await mkdtemp(join(tmpdir(), "multaiplayer-native-e2e-"));
  const relay = await startRelay(
    {
      NODE_ENV: "test",
      MULTAIPLAYER_RELAY_DEBUG: "true",
      MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
      MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: frontendUrl,
      MULTAIPLAYER_RELAY_STORAGE: "sqlite",
      MULTAIPLAYER_MLS_VALIDATOR_PATH: validatorBinary
    },
    workspace()
  );
  let browser: Awaited<ReturnType<typeof multiremote>> | undefined;
  try {
    stage("starting desktop frontend");
    const vite = spawnProcess("npm", ["run", "dev", "-w", "@multaiplayer/desktop"], {
      env: {
        VITE_DESKTOP_PORT: "1420",
        VITE_RELAY_HTTP_URL: relay.baseUrl,
        VITE_RELAY_URL: relay.wsUrl
      }
    });
    void vite;
    await waitForUrl(frontendUrl);

    stage("building native desktop shell");
    const mergedConfig = JSON.stringify({ build: { beforeDevCommand: null } });
    await run(
      "npm",
      [
        "exec",
        "--workspace",
        "@multaiplayer/desktop",
        "--",
        "tauri",
        "dev",
        "--config",
        "src-tauri/tauri.dev.conf.json",
        "--config",
        mergedConfig,
        "--runner",
        cargoBuildOnly,
        "--no-watch"
      ],
      { env: { VITE_RELAY_HTTP_URL: relay.baseUrl, VITE_RELAY_URL: relay.wsUrl }, timeoutMs: 8 * 60_000 }
    );
    await access(appBinary);
    stage("native desktop shell build completed");

    const hostLauncher = await makeIsolatedLauncher(tempRoot, "host");
    const guestLauncher = await makeIsolatedLauncher(tempRoot, "guest");
    const [hostPort, hostNativePort, guestPort, guestNativePort] = await freePorts(4);
    stage("starting native WebDriver bridges");
    spawnProcess("tauri-driver", ["--port", String(hostPort), "--native-port", String(hostNativePort)]);
    spawnProcess("tauri-driver", ["--port", String(guestPort), "--native-port", String(guestNativePort)]);
    await Promise.all([waitForDriver(hostPort), waitForDriver(guestPort)]);

    stage("creating isolated native WebDriver sessions");
    browser = await multiremote({
      host: {
        hostname: "127.0.0.1",
        port: hostPort,
        connectionRetryTimeout: webdriverOperationTimeoutMs,
        connectionRetryCount: 1,
        capabilities: {
          browserName: "wry",
          "wdio:enforceWebDriverClassic": true,
          "tauri:options": { application: hostLauncher }
        } as never
      },
      guest: {
        hostname: "127.0.0.1",
        port: guestPort,
        connectionRetryTimeout: webdriverOperationTimeoutMs,
        connectionRetryCount: 1,
        capabilities: {
          browserName: "wry",
          "wdio:enforceWebDriverClassic": true,
          "tauri:options": { application: guestLauncher }
        } as never
      }
    });
    stage("native WebDriver sessions ready");
    const host = browser.getInstance("host");
    const guest = browser.getInstance("guest");
    stage("authenticating both native clients");
    await Promise.all([
      authenticate(host, relay.baseUrl, hostIdentity),
      authenticate(guest, relay.baseUrl, guestIdentity)
    ]);
    stage("creating and bootstrapping MLS room");
    await createRoom(host);
    stage("running invite approval and Welcome processing");
    await inviteAndApprove(host, guest);
    stage("sending pre-handoff encrypted message");
    await sendAndReceive(host, guest, messageText);
    stage("transferring MLS host authority");
    await handoff(host, guest);
    stage("verifying relay host authority");
    await assertRelayHost(guest, relay.baseUrl);
    stage("sending post-handoff encrypted message");
    await sendAndReceive(guest, host, `post-handoff ${messageText}`);
    console.log("[native-e2e] real invite -> approve -> MLS message -> host handoff journey passed");
  } catch (error) {
    const reportDir = join(root, "reports/native-shell-e2e");
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, "failure.txt"), `${String(error)}\n`, "utf8");
    if (browser) {
      stage("capturing bounded failure diagnostics");
      await Promise.all([
        bestEffort("host failure screenshot", browser.getInstance("host").saveScreenshot(join(reportDir, "host.png"))),
        bestEffort(
          "guest failure screenshot",
          browser.getInstance("guest").saveScreenshot(join(reportDir, "guest.png"))
        )
      ]);
    }
    throw error;
  } finally {
    stage("cleaning up native journey resources");
    if (browser) await bestEffort("WebDriver session cleanup", browser.deleteSession());
    await Promise.all(processes.reverse().map((child) => stopProcess(child)));
    await relay.close();
    await Promise.all([
      unmountRuntimeDocumentPortal(join(tempRoot, "host/runtime/doc")),
      unmountRuntimeDocumentPortal(join(tempRoot, "guest/runtime/doc"))
    ]);
    await withTimeout(
      rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }),
      10_000,
      "isolated profile cleanup"
    ).catch((error) => {
      console.warn(`[native-e2e] isolated profile cleanup deferred: ${String(error)}`);
    });
    stage("native journey cleanup completed");
  }
}

await main();
