import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { multiremote, remote, type Browser } from "webdriverio";
import { startRelay, type RelayHarness, type StoredRelayStateFixture } from "../../apps/relay/test/support/relay.js";
import { NativeJourneyTimer, writeNativeJourneyMetrics } from "../../scripts/native-journey-metrics.mjs";
import { assertTamperedKeyPackageRejected } from "./key-package-negative.js";
import { inviteAndDeny, rejectExpiredInvite } from "./invite-scenarios.js";
import { approveInviteAcrossGuestCrash } from "./messy-failure.js";
import { RestartableRelayProxy } from "./restart-proxy.js";
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

async function authenticate(
  browser: Browser,
  relayBaseUrl: string,
  identity: Identity,
  { keepOnboarding = false }: { keepOnboarding?: boolean } = {}
) {
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
  if (keepOnboarding) {
    await visible(browser, ".onboarding-assistant");
    await visible(browser, "h1=Work with Codex together");
    return;
  }
  // The debug-auth refresh can recreate the isolated WebKitGTK test page.
  // Keep the setup bypass idempotent so this relay-auth fixture does not
  // mistake a second first-run surface for an authentication failure.
  await dismissFirstRunAfterRefresh(browser);
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

async function assertFirstRunWelcome(browser: Browser) {
  // WebKitWebDriver supports parallel clients, but concurrent commands within
  // one session can wedge the GTK bridge. Keep each client's probes ordered.
  await visible(browser, ".onboarding-assistant");
  await visible(browser, "h1=Work with Codex together");
}

async function dismissFirstRunAfterRefresh(browser: Browser) {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const profileVisible = [...document.querySelectorAll("button")].some(
          (button) => button.textContent?.trim() === "Profile" && button.getClientRects().length > 0
        );
        if (profileVisible) return true;

        const assistant = document.querySelector(".onboarding-assistant");
        if (!assistant) return false;
        const action =
          assistant.querySelector<HTMLButtonElement>(".onboarding-explore") ??
          [...assistant.querySelectorAll<HTMLButtonElement>("button")].find(
            (button) => button.textContent?.trim() === "Save and close"
          );
        action?.click();
        return false;
      }),
    {
      timeout: 30_000,
      timeoutMsg: "native shell did not settle on the workspace after debug authentication"
    }
  );
}

async function waitForReadinessText(browser: Browser, label: string, expected: RegExp) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (targetLabel, source, flags) => {
          const row = [...document.querySelectorAll(".onboarding-readiness-row")].find(
            (candidate) => candidate.querySelector("strong")?.textContent?.trim() === targetLabel
          );
          return new RegExp(source, flags).test(row?.textContent ?? "");
        },
        label,
        expected.source,
        expected.flags
      ),
    { timeout: 30_000, timeoutMsg: `${label} readiness did not settle to ${expected}` }
  );
}

async function createRoomThroughOnboarding(host: Browser) {
  await (await visible(host, '//button[.//strong[normalize-space(.)="Create a workspace"]]')).click();
  await visible(host, "h1=Check this device");
  await waitForReadinessText(host, "Relay", /connected/i);
  await waitForReadinessText(host, "GitHub", /signed in/i);

  // GitHub authentication is supplied by the loopback-only relay fixture. A
  // real third-party ChatGPT authorization cannot run in ordinary CI, so this
  // moves only from readiness to the production create form. The form and all
  // relay/native workspace handlers below are unmodified production paths.
  await host.execute(() => {
    const storeModule = "/src/store/appStore.ts";
    return import(/* @vite-ignore */ storeModule).then(({ useAppStore }) =>
      useAppStore.getState().applyOnboardingEvent({ type: "show_surface", surface: "workspace" })
    );
  });

  await visible(host, "h1=Create your workspace");
  await (await visible(host, 'input[id$="-workspace"]')).setValue("Native Onboarding Team");
  await (await visible(host, 'input[id$="-room"]')).setValue(roomName);
  await (await visible(host, 'input[id$="-project"]')).setValue(root);
  await (await visible(host, "button=Create workspace")).click();
  await visible(host, "h1=Start with safe defaults", 60_000);
  await (await visible(host, "button=Enter room")).click();

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

async function prepareJoinOnboarding(guest: Browser) {
  await (await visible(guest, '//button[.//strong[normalize-space(.)="Join with an invite"]]')).click();
  await visible(guest, "h1=Check this device");
  await waitForReadinessText(guest, "Relay", /connected/i);
  await waitForReadinessText(guest, "GitHub", /signed in/i);
  const codexStatus = await guest.execute(() => {
    const row = [...document.querySelectorAll(".onboarding-readiness-row")].find(
      (candidate) => candidate.querySelector("strong")?.textContent?.trim() === "Codex"
    );
    return row?.getAttribute("data-status") ?? null;
  });
  assert.notEqual(codexStatus, "blocked", "join onboarding treated local Codex hosting as a membership prerequisite");
  const continueButton = await visible(guest, "button=Continue");
  await continueButton.waitForEnabled({
    timeout: 30_000,
    timeoutMsg: "join onboarding stayed blocked on host-only Codex readiness"
  });
  await continueButton.click();
  await visible(guest, "h1=Join a workspace");
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
          [...document.querySelectorAll(".chat-scroll article.message .message-markdown")].some(
            (element) => element.textContent?.trim() === expectedText
          ),
        text
      ),
    { timeout: 60_000, timeoutMsg: `receiver did not display the encrypted message: ${text}` }
  );
}

async function handoff(host: Browser, guest: Browser) {
  await (await visible(host, "button=Handoff")).click();
  const available = await visible(guest, ".handoff-row.available", 60_000);
  const requestButton = await available.$("button=Request handoff");
  const folderApproval = runtime.run(
    "bash",
    [
      "-euo",
      "pipefail",
      "-c",
      `initial_windows="$(xdotool search --onlyvisible --name '.*' 2>/dev/null || true)"
for _ in $(seq 1 100); do
  current_windows="$(xdotool search --onlyvisible --name '.*' 2>/dev/null || true)"
  for current_window in $current_windows; do
    if ! printf '%s\n' "$initial_windows" | grep -qx "$current_window"; then
      window_name="$(xdotool getwindowname "$current_window" 2>/dev/null || true)"
      echo "native handoff folder chooser: window=$current_window name=$window_name"
      # Focus the X11 window directly. windowactivate requires a window
      # manager, which would reparent the WRY app windows and break WebDriver's
      # native coordinate mapping under Xvfb.
      xdotool windowfocus --sync "$current_window"
      # Once focused, omit --window so xdotool uses XTest input. GTK rejects
      # the XSendEvent path used by targeted key events under this portal.
      xdotool key --clearmodifiers ctrl+l
      sleep 0.2
      xdotool type --clearmodifiers --delay 1 -- "$HANDOFF_PROJECT_ROOT"
      xdotool key --clearmodifiers Return
      sleep 0.5
      eval "$(xdotool getwindowgeometry --shell "$current_window")"
      echo "native handoff folder chooser geometry: \${WIDTH}x\${HEIGHT}"
      # GTK's affirmative Select/Open button is the rightmost control in the
      # bottom action row. Move relative to the dialog and use a real XTest
      # pointer event; GTK rejects targeted synthetic key events under Xvfb.
      xdotool mousemove --sync --window "$current_window" "$((WIDTH - 52))" "$((HEIGHT - 29))"
      xdotool click 1
      for _ in $(seq 1 20); do
        if ! xdotool getwindowname "$current_window" >/dev/null 2>&1; then
          echo "native handoff folder chooser closed"
          exit 0
        fi
        sleep 0.1
      done
      echo "native handoff folder chooser remained open after confirmation" >&2
      exit 1
    fi
  done
  sleep 0.1
done
echo "native handoff folder chooser did not become active" >&2
exit 1`
    ],
    { env: { HANDOFF_PROJECT_ROOT: root }, timeoutMs: 20_000 }
  );
  await Promise.all([requestButton.click(), folderApproval]);
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

async function acceptedMlsEpoch(browser: Browser, relayBaseUrl: string) {
  const result = await browser.executeAsync(
    (baseUrl, targetRoomName, done) => {
      fetch(`${baseUrl}/teams`, { credentials: "include" })
        .then(async (response) => {
          const body = (await response.json()) as { rooms?: Array<{ name?: string; acceptedMlsEpoch?: number }> };
          done({
            status: response.status,
            epoch: body.rooms?.find((candidate) => candidate.name === targetRoomName)?.acceptedMlsEpoch
          });
        })
        .catch((error) => done({ error: String(error) }));
    },
    relayBaseUrl,
    roomName
  );
  assert.equal((result as { status?: number }).status, 200, `relay epoch lookup failed: ${JSON.stringify(result)}`);
  const epoch = (result as { epoch?: number }).epoch;
  assert.ok(Number.isSafeInteger(epoch) && epoch! > 0, `relay did not persist the membership Commit epoch: ${epoch}`);
  return epoch!;
}

async function main() {
  stage("initializing native journey");
  if (process.platform !== "linux") throw new Error("Native shell E2E requires Linux WebKitWebDriver and Xvfb");
  const tempRoot = await mkdtemp(join(tmpdir(), "multaiplayer-native-e2e-"));
  const relayEnvironment = {
    NODE_ENV: "test",
    MULTAIPLAYER_RELAY_DEBUG: "true",
    MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
    MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: frontendUrl,
    MULTAIPLAYER_RELAY_STORAGE: "sqlite",
    MULTAIPLAYER_MLS_VALIDATOR_PATH: validatorBinary
  };
  let relay: RelayHarness | undefined;
  let relayProxy: RestartableRelayProxy | undefined;
  let browser: Awaited<ReturnType<typeof multiremote>> | undefined;
  let restartedGuest: Browser | undefined;
  try {
    relay = await startRelay(relayEnvironment, workspace());
    const relayDataPath = relay.dataPath;
    relayProxy = await RestartableRelayProxy.start(relay.baseUrl);
    const stableRelayProxy = relayProxy;
    stage("starting desktop frontend");
    const vite = runtime.spawn("npm", ["run", "dev", "-w", "@multaiplayer/desktop"], {
      env: {
        VITE_DESKTOP_PORT: "1420",
        VITE_RELAY_HTTP_URL: stableRelayProxy.baseUrl,
        VITE_RELAY_URL: stableRelayProxy.wsUrl
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
      {
        env: { VITE_RELAY_HTTP_URL: stableRelayProxy.baseUrl, VITE_RELAY_URL: stableRelayProxy.wsUrl },
        timeoutMs: 8 * 60_000
      }
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
    let guest = browser.getInstance("guest");
    await Promise.all([assertFirstRunWelcome(host), assertFirstRunWelcome(guest)]);
    assert.equal(
      await (await host.$("h1=Work with Codex together")).isFocused(),
      true,
      "first-run onboarding did not focus its welcome heading"
    );
    stage("authenticating both native clients");
    await Promise.all([
      authenticate(host, stableRelayProxy.baseUrl, hostIdentity, { keepOnboarding: true }),
      authenticate(guest, stableRelayProxy.baseUrl, guestIdentity, { keepOnboarding: true })
    ]);
    stage("creating a workspace and room through native onboarding");
    await createRoomThroughOnboarding(host);
    stage("proving join readiness does not require local Codex hosting");
    await prepareJoinOnboarding(guest);
    stage("proving the real validator rejects a tampered native KeyPackage");
    const guestDeviceId = await assertTamperedKeyPackageRejected(
      guest,
      stableRelayProxy.baseUrl,
      "team-native-e2e",
      guestIdentity.id
    );
    const inviteContext = {
      roomName,
      guestUserId: guestIdentity.id,
      guestDeviceId,
      relayBaseUrl: stableRelayProxy.baseUrl
    };
    stage("denying admission and proving the guest native MLS group stays locked");
    await inviteAndDeny(host, guest, inviteContext);
    stage("rejecting an expired invite capability before KeyPackage publication");
    await rejectExpiredInvite(host, guest, inviteContext);
    stage("crashing the guest and restarting the relay after Commit before Welcome delivery");
    const welcomeGate = stableRelayProxy.armInviteResponseGate();
    guest = await approveInviteAcrossGuestCrash(host, guest, {
      ...inviteContext,
      hostUserId: hostIdentity.id,
      async killGuest() {
        await runtime.killIsolatedApp(tempRoot, "guest");
        await runtime.bestEffort("clear crashed guest WebDriver session", guest.deleteSession());
      },
      async restartGuest() {
        const nextGuest = await remote({
          hostname: "127.0.0.1",
          port: guestPort,
          connectionRetryTimeout: webdriverOperationTimeoutMs,
          connectionRetryCount: 1,
          capabilities: {
            browserName: "wry",
            "wdio:enforceWebDriverClassic": true,
            "tauri:options": { application: guestLauncher }
          } as never
        });
        restartedGuest = nextGuest;
        await authenticate(nextGuest, stableRelayProxy.baseUrl, guestIdentity);
        return nextGuest;
      },
      async afterApprovalStarted() {
        await runtime.withTimeout(
          welcomeGate.blocked,
          60_000,
          "membership Commit did not reach the pre-Welcome relay restart boundary"
        );
        try {
          const committedEpoch = await acceptedMlsEpoch(host, stableRelayProxy.baseUrl);
          await relay.close({ preserveData: true });
          relay = await startRelay(relayEnvironment, undefined, relayDataPath);
          stableRelayProxy.setTarget(relay.baseUrl);
          assert.equal(
            await acceptedMlsEpoch(host, stableRelayProxy.baseUrl),
            committedEpoch,
            "restarted SQLite relay did not recover the accepted membership Commit epoch"
          );
        } finally {
          welcomeGate.release();
        }
      }
    });
    stage("sending pre-handoff encrypted message");
    await sendAndReceive(host, guest, messageText);
    stage("transferring MLS host authority");
    await handoff(host, guest);
    stage("verifying relay host authority");
    await assertRelayHost(guest, stableRelayProxy.baseUrl);
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
          (restartedGuest ?? browser.getInstance("guest")).saveScreenshot(join(reportDir, "guest.png"))
        )
      ]);
    }
    throw error;
  } finally {
    stage("cleaning up native journey resources");
    if (restartedGuest) await runtime.bestEffort("restarted guest WebDriver cleanup", restartedGuest.deleteSession());
    if (browser) await runtime.bestEffort("WebDriver session cleanup", browser.deleteSession());
    await runtime.stopProcesses();
    if (relayProxy) await relayProxy.close();
    if (relay) await relay.close();
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
