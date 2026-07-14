import assert from "node:assert/strict";
import type { Browser } from "webdriverio";
import {
  createInviteLink,
  importInvite,
  loadPendingInviteRequest,
  openRoomInspector,
  selectRoom,
  waitForGuestInviteRequest,
  type InviteScenarioContext
} from "./invite-scenarios.js";

interface InterruptedApprovalContext extends InviteScenarioContext {
  hostUserId: string;
  killGuest: () => Promise<void>;
  restartGuest: () => Promise<Browser>;
  afterApprovalStarted?: () => Promise<void>;
}

/**
 * Proves that a Welcome persisted while the requesting app is offline remains
 * bound to that device and can be processed after its native profile and
 * credential store restart.
 */
export async function approveInviteAcrossGuestCrash(
  host: Browser,
  guest: Browser,
  context: InterruptedApprovalContext
): Promise<Browser> {
  const invite = await createInviteLink(host);
  await importInvite(guest, invite, context.roomName);
  await waitForGuestInviteRequest(guest);
  const request = await loadPendingInviteRequest(host, context);
  const approve = await request.$("button");
  await approve.waitForEnabled({ timeout: 60_000, timeoutMsg: "interrupted invite approval was not available" });

  await context.killGuest();
  await approve.click();
  await context.afterApprovalStarted?.();
  try {
    await host.waitUntil(
      () => host.execute(() => Boolean(document.querySelector(".invite-panel .terminal-request.approved"))),
      {
        timeout: 60_000,
        timeoutMsg: "host did not persist an approval and Welcome while the requesting client was offline"
      }
    );
  } catch (error) {
    const diagnostics = await host.execute(() => ({
      workflowMessage: document.querySelector(".invite-panel .workflow-message")?.textContent?.trim() ?? "",
      pendingRequest: document.querySelector(".invite-panel .terminal-request.pending")?.textContent?.trim() ?? ""
    }));
    throw new Error(`${String(error)}; host invite diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const restartedGuest = await context.restartGuest();
  await selectRoom(restartedGuest, context.roomName);
  await openRoomInspector(restartedGuest);
  await restartedGuest.waitUntil(
    () =>
      restartedGuest.execute(() => {
        const message = document.querySelector(".invite-panel .workflow-message")?.textContent ?? "";
        return /approved|unlocked|joined/i.test(message);
      }),
    {
      timeout: 60_000,
      timeoutMsg: "restarted guest did not recover and process its durable Welcome"
    }
  );
  await visible(restartedGuest, ".invite-panel .terminal-request.approved", 60_000);
  await assertRecoveredNativeMembership(restartedGuest, context);
  return restartedGuest;
}

async function assertRecoveredNativeMembership(browser: Browser, context: InterruptedApprovalContext) {
  let lastError = "native MLS group state was unavailable";
  let roster: Array<{ githubUserId: string; deviceId: string }> = [];
  try {
    await browser.waitUntil(
      async () => {
        const result = await browser.executeAsync((targetRoomName, done) => {
          Promise.all([import("/src/store/appStore.ts"), import("/src/lib/mlsClient.ts")])
            .then(([{ useAppStore }, { mlsGroupState }]) => {
              const room = useAppStore
                .getState()
                .rooms.find((candidate: { id: string; name: string }) => candidate.name === targetRoomName);
              if (!room) throw new Error(`Room ${targetRoomName} is unavailable after native restart`);
              return mlsGroupState(room.id);
            })
            .then((value) => done({ value }))
            .catch((error) => done({ error: String(error) }));
        }, context.roomName);
        const state = result as {
          value?: { roster?: Array<{ githubUserId: string; deviceId: string }> };
          error?: string;
        };
        lastError = state.error ?? lastError;
        roster = state.value?.roster ?? [];
        return (
          roster.some(
            (member) => member.githubUserId === context.guestUserId && member.deviceId === context.guestDeviceId
          ) && roster.some((member) => member.githubUserId === context.hostUserId)
        );
      },
      { timeout: 60_000, timeoutMsg: "restarted guest did not restore the approved native MLS roster" }
    );
  } catch (error) {
    throw new Error(`${String(error)}: ${lastError}`);
  }
  assert.equal(
    roster.some((member) => member.githubUserId === context.guestUserId && member.deviceId === context.guestDeviceId),
    true,
    "recovered MLS group was not bound to the original requesting device"
  );
}

async function visible(browser: Browser, selector: string, timeout: number) {
  const element = await browser.$(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}
