import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { multiremote, type Browser } from "webdriverio";
import { startRelay, type StoredRelayStateFixture } from "../../apps/relay/test/support/relay.js";
import { NativeJourneyTimer, writeNativeJourneyMetrics } from "../../scripts/native-journey-metrics.mjs";
import { assertTamperedKeyPackageRejected } from "./key-package-negative.js";
import { inviteAndApprove, inviteAndDeny, rejectExpiredInvite } from "./invite-scenarios.js";
import { NativeShellRuntime } from "./runtime.js";

const root = resolve(import.meta.dirname, "../..");
const desktopRoot = join(root, "apps/desktop");
const appBinary = join(desktopRoot, "src-tauri/target/debug/multaiplayer");
const validatorBinary = join(desktopRoot, "src-tauri/target/debug/mls-keypackage-validator");
const cargoBuildOnly = join(root, "e2e/native-shell/cargo-build-only.sh");
const frontendUrl = "http://127.0.0.1:1420";
const roomName = `Native integration ${Date.now()}`;
const messageText = `real MLS message ${Date.now()}`;
const webdriverOperationTimeoutMs = 15_000;
const journeyWarningBudgetMs = 6 * 60_000;
const journeyTimer = new NativeJourneyTimer();
const runtime = new NativeShellRuntime({ root, appBinary, operationTimeoutMs: webdriverOperationTimeoutMs });

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

function stage(message: string) {
  journeyTimer.markStage(message);
  console.log(`[native-e2e] ${new Date().toISOString()} ${message}`);
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
  return runtime
    .withTimeout(handoffDiagnostics(browser), webdriverOperationTimeoutMs, `${client} handoff diagnostics`)
    .catch((error) => ({ error: String(error) }));
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
  stage("initializing native journey");
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
    const vite = runtime.spawn("npm", ["run", "dev", "-w", "@multaiplayer/desktop"], {
      env: {
        VITE_DESKTOP_PORT: "1420",
        VITE_RELAY_HTTP_URL: relay.baseUrl,
        VITE_RELAY_URL: relay.wsUrl
      }
    });
    void vite;
    await runtime.waitForUrl(frontendUrl);

    stage("building native desktop shell");
    const mergedConfig = JSON.stringify({ build: { beforeDevCommand: null } });
    await runtime.run(
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

    const hostLauncher = await runtime.makeIsolatedLauncher(tempRoot, "host");
    const guestLauncher = await runtime.makeIsolatedLauncher(tempRoot, "guest");
    const [hostPort, hostNativePort, guestPort, guestNativePort] = await runtime.freePorts(4);
    stage("starting native WebDriver bridges");
    runtime.spawn("tauri-driver", ["--port", String(hostPort), "--native-port", String(hostNativePort)]);
    runtime.spawn("tauri-driver", ["--port", String(guestPort), "--native-port", String(guestNativePort)]);
    await Promise.all([runtime.waitForDriver(hostPort), runtime.waitForDriver(guestPort)]);

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
    stage("proving the real validator rejects a tampered native KeyPackage");
    const guestDeviceId = await assertTamperedKeyPackageRejected(
      guest,
      relay.baseUrl,
      "team-native-e2e",
      guestIdentity.id
    );
    const inviteContext = { roomName, guestUserId: guestIdentity.id, guestDeviceId, relayBaseUrl: relay.baseUrl };
    stage("denying admission and proving the guest native MLS group stays locked");
    await inviteAndDeny(host, guest, inviteContext);
    stage("rejecting an expired invite capability before KeyPackage publication");
    await rejectExpiredInvite(host, guest, inviteContext);
    stage("running invite approval and Welcome processing");
    await inviteAndApprove(host, guest, inviteContext);
    stage("sending pre-handoff encrypted message");
    await sendAndReceive(host, guest, messageText);
    stage("transferring MLS host authority");
    await handoff(host, guest);
    stage("verifying relay host authority");
    await assertRelayHost(guest, relay.baseUrl);
    stage("sending post-handoff encrypted message");
    await sendAndReceive(guest, host, `post-handoff ${messageText}`);
    console.log(
      "[native-e2e] real validator rejection -> deny/locked -> expired capability rejection -> approve -> MLS message -> host handoff journey passed"
    );
  } catch (error) {
    const reportDir = join(root, "reports/native-shell-e2e");
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, "failure.txt"), `${String(error)}\n`, "utf8");
    if (browser) {
      stage("capturing bounded failure diagnostics");
      await Promise.all([
        runtime.bestEffort(
          "host failure screenshot",
          browser.getInstance("host").saveScreenshot(join(reportDir, "host.png"))
        ),
        runtime.bestEffort(
          "guest failure screenshot",
          browser.getInstance("guest").saveScreenshot(join(reportDir, "guest.png"))
        )
      ]);
    }
    throw error;
  } finally {
    stage("cleaning up native journey resources");
    if (browser) await runtime.bestEffort("WebDriver session cleanup", browser.deleteSession());
    await runtime.stopProcesses();
    await relay.close();
    await runtime.cleanupProfiles(tempRoot, ["host", "guest"]);
    stage("native journey cleanup completed");
  }
}

let journeyOutcome: "passed" | "failed" = "failed";
try {
  await main();
  journeyOutcome = "passed";
} finally {
  const report = journeyTimer.finish(journeyOutcome, {
    platform: `${process.platform}-${process.arch}`,
    runnerOs: process.env.RUNNER_OS ?? null,
    gitSha: process.env.GITHUB_SHA ?? null,
    warningBudgetMs: journeyWarningBudgetMs
  });
  await writeNativeJourneyMetrics(
    report,
    join(root, "reports/native-shell-e2e"),
    process.env.GITHUB_STEP_SUMMARY
  ).catch((error) => console.warn(`[native-e2e] failed to write duration metrics: ${String(error)}`));
  if (report.totalDurationMs > journeyWarningBudgetMs) {
    console.warn(
      `::warning title=Native journey duration regression::Journey took ${(report.totalDurationMs / 1_000).toFixed(1)}s, exceeding the ${(journeyWarningBudgetMs / 1_000).toFixed(0)}s warning budget.`
    );
  }
  console.log(`[native-e2e] total journey duration: ${(report.totalDurationMs / 1_000).toFixed(1)}s`);
}
