import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Browser } from "webdriverio";
import { keyPackageCount } from "./key-package-negative.js";

export interface InviteScenarioContext {
  roomName: string;
  guestUserId: string;
  guestDeviceId: string;
  relayBaseUrl: string;
}

async function visible(browser: Browser, selector: string, timeout = 30_000) {
  const element = await browser.$(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

export async function selectRoom(browser: Browser, roomName: string) {
  const selectionState = async () =>
    browser.execute((expected) => {
      if (document.querySelector<HTMLInputElement>('input[aria-label="Room title"]')?.value === expected) {
        return "selected";
      }
      return [...document.querySelectorAll<HTMLButtonElement>("button.room-button")].some((candidate) =>
        candidate.textContent?.includes(expected)
      )
        ? "available"
        : null;
    }, roomName);

  await browser.waitUntil(async () => (await selectionState()) !== null, {
    timeout: 60_000,
    timeoutMsg: `room ${roomName} was neither selected nor available after native startup`
  });
  if ((await selectionState()) === "selected") return;
  const room = await visible(
    browser,
    `//button[contains(concat(" ", normalize-space(@class), " "), " room-button ") and contains(., "${roomName}")]`,
    30_000
  );
  await room.click();
  const title = await visible(browser, 'input[aria-label="Room title"]');
  await title.waitUntil(async () => (await title.getValue()) === roomName, { timeout: 30_000 });
}

export async function openRoomInspector(browser: Browser) {
  const tools = await visible(browser, 'nav[aria-label="Room tools"]');
  await (await tools.$("button=Room")).click();
}

export async function createInviteLink(host: Browser) {
  await openRoomInspector(host);
  const previousInvite = await host.execute(() => document.querySelector(".invite-link")?.textContent?.trim() ?? "");
  await (await visible(host, "button=Copy room invite")).click();
  await host.waitUntil(
    () =>
      host.execute((previous) => {
        const current = document.querySelector(".invite-link")?.textContent?.trim() ?? "";
        return current.length > 0 && current !== previous;
      }, previousInvite),
    { timeout: 30_000, timeoutMsg: "host did not issue a fresh protected invite capability" }
  );
  const invite = await host.execute(() => document.querySelector(".invite-link")?.textContent?.trim() ?? "");
  assert.match(invite, /^https:\/\/open\.multaiplayer\.com\/invite#invite=/);
  assert.match(invite, /&multaiplayerJoin=/);
  return invite;
}

export async function importInvite(guest: Browser, invite: string, roomName: string) {
  await selectRoom(guest, roomName);
  await openRoomInspector(guest);
  await (await visible(guest, 'textarea[placeholder="Paste a multAIplayer invite..."]')).setValue(invite);
  await (await visible(guest, "button=Import invite")).click();
}

export async function submitInviteThroughOnboarding(guest: Browser, invite: string) {
  const input = await visible(guest, ".onboarding-field input");
  await input.setValue(invite);
  await (await visible(guest, "button=Accept invite")).click();
}

export async function waitForGuestInviteRequest(guest: Browser) {
  await guest.waitUntil(
    () =>
      guest.execute(() =>
        (document.querySelector(".invite-panel .workflow-message")?.textContent ?? "").includes("Requested access")
      ),
    { timeout: 60_000, timeoutMsg: "guest did not persist the protected invite request" }
  );
}

async function passDeviceVerificationGuidance(guest: Browser, roomName: string) {
  await visible(guest, "h1=Join a workspace", 60_000);
  const verification = await visible(guest, '.onboarding-join-state[data-phase="verification_required"]');
  assert.match(
    await verification.getText(),
    /Device verification required.*active host must verify and approve this device/is,
    "onboarding did not explain the host-approval boundary"
  );
  await (await visible(guest, "button=Save and close")).click();
  await visible(guest, "button=Profile");
  await selectRoom(guest, roomName);
  await openRoomInspector(guest);
}

export async function loadPendingInviteRequest(host: Browser, context: InviteScenarioContext) {
  await host.refresh();
  await visible(host, ".profile-card strong");
  await selectRoom(host, context.roomName);
  await openRoomInspector(host);
  const request = await visible(host, ".invite-panel .terminal-request.pending", 60_000);
  const requestText = await host.execute(
    () => document.querySelector(".invite-panel .terminal-request.pending")?.textContent ?? ""
  );
  assert.ok(requestText.includes(context.guestUserId), "host did not receive the guest's authenticated identity");
  assert.match(requestText, /Capability-authenticated MLS KeyPackage request/);
  return request;
}

async function assertGuestMlsGroupLocked(guest: Browser, roomName: string, assertionContext: string) {
  const resultKey = randomUUID();
  await guest.execute(
    (targetRoomName, key) => {
      const page = globalThis as typeof globalThis & {
        __multaiplayerGroupStateResults?: Record<string, { state?: unknown; message?: string } | undefined>;
      };
      const results = (page.__multaiplayerGroupStateResults ??= {});
      results[key] = undefined;
      const storeModule = "/src/store/appStore.ts";
      const mlsModule = "/src/lib/mlsClient.ts";
      void Promise.all([import(/* @vite-ignore */ storeModule), import(/* @vite-ignore */ mlsModule)])
        .then(([{ useAppStore }, { mlsGroupState }]) => {
          const room = useAppStore
            .getState()
            .rooms.find((candidate: { id: string; name: string }) => candidate.name === targetRoomName);
          if (!room) throw new Error(`Room ${targetRoomName} is unavailable in the guest store`);
          return mlsGroupState(room.id);
        })
        .then((state) => {
          results[key] = { state };
        })
        .catch((error) => {
          results[key] = { message: String(error) };
        });
    },
    roomName,
    resultKey
  );
  await guest.waitUntil(
    () =>
      guest.execute((key) => {
        const page = globalThis as typeof globalThis & {
          __multaiplayerGroupStateResults?: Record<string, { state?: unknown; message?: string } | undefined>;
        };
        return page.__multaiplayerGroupStateResults?.[key] !== undefined;
      }, resultKey),
    { timeout: 30_000, timeoutMsg: `${assertionContext}: native MLS group-state lookup did not settle` }
  );
  const result = await guest.execute((key) => {
    const page = globalThis as typeof globalThis & {
      __multaiplayerGroupStateResults?: Record<string, { state?: unknown; message?: string } | undefined>;
    };
    const value = page.__multaiplayerGroupStateResults?.[key];
    if (page.__multaiplayerGroupStateResults) delete page.__multaiplayerGroupStateResults[key];
    return value;
  }, resultKey);
  assert.ok(result, `${assertionContext}: native MLS group-state result disappeared before collection`);
  assert.equal("state" in result, false, `${assertionContext}: guest unexpectedly had native MLS group state`);
  assert.match(
    result.message ?? "",
    /group is not open/i,
    `${assertionContext}: native MLS lookup did not report an absent group`
  );
}

export async function inviteAndDeny(host: Browser, guest: Browser, context: InviteScenarioContext) {
  const invite = await createInviteLink(host);
  await submitInviteThroughOnboarding(guest, invite);
  await passDeviceVerificationGuidance(guest, context.roomName);
  await waitForGuestInviteRequest(guest);
  const request = await loadPendingInviteRequest(host, context);
  const deny = await request.$("button:last-child");
  await deny.waitForEnabled({ timeout: 60_000, timeoutMsg: "host invite denial did not become available" });
  await deny.click();
  await visible(host, ".invite-panel .terminal-request.denied", 60_000);
  await guest.waitUntil(
    () =>
      guest.execute(() =>
        (document.querySelector(".invite-panel .workflow-message")?.textContent ?? "").includes("denied access")
      ),
    { timeout: 60_000, timeoutMsg: "guest did not receive the native capability-authenticated denial" }
  );
  await visible(guest, ".invite-panel .terminal-request.denied", 60_000);
  await assertGuestMlsGroupLocked(guest, context.roomName, "after host denial");
}

export async function rejectExpiredInvite(host: Browser, guest: Browser, context: InviteScenarioContext) {
  const pendingBefore = await host.execute(
    () => document.querySelectorAll(".invite-panel .terminal-request.pending").length
  );
  const keyPackagesBefore = await keyPackageCount(guest, context.relayBaseUrl, context.guestDeviceId);
  assert.equal(keyPackagesBefore.status, 200, "could not count guest KeyPackages before expiry rejection");
  const invite = await createInviteLink(host);
  const inviteUrl = new URL(invite);
  const inviteId = new URLSearchParams(inviteUrl.hash.slice(1)).get("invite");
  assert.ok(inviteId, "generated invite did not contain a relay invite id");
  const expired = await guest.executeAsync(
    (baseUrl, targetInviteId, done) => {
      fetch(`${baseUrl}/debug/invites/${encodeURIComponent(targetInviteId)}/expire`, {
        method: "POST",
        credentials: "include"
      })
        .then((response) => done({ status: response.status }))
        .catch((error) => done({ error: String(error) }));
    },
    context.relayBaseUrl,
    inviteId
  );
  assert.deepEqual(expired, { status: 204 }, "loopback expiry control did not backdate the real relay invite");
  await importInvite(guest, invite, context.roomName);
  await guest.waitUntil(
    () =>
      guest.execute(() =>
        /invite.*expired/i.test(document.querySelector(".invite-panel .workflow-message")?.textContent ?? "")
      ),
    { timeout: 30_000, timeoutMsg: "expired capability was not rejected by the native invite flow" }
  );
  const prunedStatus = await guest.executeAsync(
    (baseUrl, targetInviteId, done) => {
      const probe = new URL(`${baseUrl}/invites/${encodeURIComponent(targetInviteId)}`);
      probe.searchParams.set("pruneProbe", crypto.randomUUID());
      fetch(probe, { credentials: "include", cache: "no-store" })
        .then((response) => done(response.status))
        .catch((error) => done(String(error)));
    },
    context.relayBaseUrl,
    inviteId
  );
  assert.equal(prunedStatus, 404, "production invite lookup did not prune the expired relay capability");
  const keyPackagesAfter = await keyPackageCount(guest, context.relayBaseUrl, context.guestDeviceId);
  assert.equal(keyPackagesAfter.status, 200, "could not count guest KeyPackages after expiry rejection");
  assert.equal(
    keyPackagesAfter.body?.count,
    keyPackagesBefore.body?.count,
    "expired invite lookup unexpectedly generated or published a guest KeyPackage"
  );
  await host.refresh();
  await visible(host, ".profile-card strong");
  await selectRoom(host, context.roomName);
  await openRoomInspector(host);
  const pendingAfter = await host.execute(
    () => document.querySelectorAll(".invite-panel .terminal-request.pending").length
  );
  assert.equal(pendingAfter, pendingBefore, "expired capability unexpectedly reached the host as an invite request");
  await assertGuestMlsGroupLocked(guest, context.roomName, "after expired capability rejection");
}

export async function inviteAndApprove(host: Browser, guest: Browser, context: InviteScenarioContext) {
  const invite = await createInviteLink(host);
  await importInvite(guest, invite, context.roomName);
  await waitForGuestInviteRequest(guest);
  const request = await loadPendingInviteRequest(host, context);
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
