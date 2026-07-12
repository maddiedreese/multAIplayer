import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  approvePendingInvite,
  copyApprovalInvite,
  createRoom,
  openAuthenticatedClient,
  requestInviteAccess,
  sendRoomMessage,
  type AuthenticatedClient,
  type TestIdentity
} from "./helpers";

async function createIsolatedRoom(
  page: Page,
  prefix: string
): Promise<{ name: string; roomId: string; teamName: string }> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const teamName = `${prefix} team ${suffix}`;
  const name = `${prefix} room ${suffix}`;
  await page.getByRole("button", { name: "New team" }).click();
  await page.getByPlaceholder("Team name").fill(teamName);
  await page.getByRole("button", { name: "Create team" }).click();
  await createRoom(page, name, teamName);
  await page.getByRole("button", { name: "Host", exact: true }).click();
  await expect(page.getByRole("button", { name: "Handoff", exact: true })).toBeEnabled();
  const roomId = await page.evaluate(async (roomName) => {
    const response = await fetch("http://127.0.0.1:4322/teams", { credentials: "include" });
    const workspace = (await response.json()) as { rooms: Array<{ id: string; name: string }> };
    const room = workspace.rooms.find((candidate) => candidate.name === roomName);
    if (!room) throw new Error(`Relay did not return ${roomName}.`);
    return room.id;
  }, name);
  return { name, roomId, teamName };
}

async function currentKeyEpoch(page: Page, roomId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const loadModule = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<typeof import("../apps/desktop/src/lib/localHistory")>;
    const { loadRoomKeyring } = await loadModule("/src/lib/localHistory.ts");
    const keyring = await loadRoomKeyring(id);
    if (!keyring) throw new Error(`No local keyring exists for ${id}.`);
    return keyring.currentEpoch;
  }, roomId);
}

async function openGuest(browser: Browser, label: string): Promise<AuthenticatedClient> {
  const identity: TestIdentity = {
    id: `github:e2e-${label}`,
    login: `e2e-${label}`,
    name: `E2E ${label}`
  };
  return openAuthenticatedClient(browser, identity);
}

test.describe("desktop security-critical journeys", () => {
  test("invite acceptance requires an explicit host decision before room access", async ({ browser }) => {
    const host = await openGuest(browser, "invite-host");
    const guest = await openGuest(browser, "invite-guest");
    try {
      const room = await createIsolatedRoom(host.page, "Invite acceptance");
      const invite = await copyApprovalInvite(host.page);
      await requestInviteAccess(guest.page, invite);

      const pendingRequest = host.page.locator(".terminal-request.pending").first();
      await expect(pendingRequest).toBeVisible();
      await expect(guest.page.getByRole("textbox", { name: "Room title" })).toHaveValue(room.name);
      await expect(guest.page.getByRole("button", { name: "Send message" })).toBeDisabled();

      await approvePendingInvite(host.page, guest.page);
      await expect(guest.page.getByRole("textbox", { name: "Room title" })).toHaveValue(room.name);
      await expect(guest.page.getByPlaceholder(/Message the room/)).toBeEnabled();
      await expect(guest.page.locator(".room-button.nested.active", { hasText: room.name })).toBeVisible();

      const marker = `invite accepted ${Date.now()}`;
      await sendRoomMessage(guest.page, marker);
      await expect(host.page.getByText(marker, { exact: true })).toBeVisible();
    } finally {
      await Promise.all([host.context.close(), guest.context.close()]);
    }
  });

  test("member removal rotates the room key and revokes the removed desktop", async ({ browser }) => {
    const host = await openGuest(browser, "rotation-host");
    const removed = await openGuest(browser, "rotation-removed");
    try {
      const room = await createIsolatedRoom(host.page, "Removal rotation");
      await requestInviteAccess(removed.page, await copyApprovalInvite(host.page));
      await approvePendingInvite(host.page, removed.page);
      const epochBeforeRemoval = await currentKeyEpoch(host.page, room.roomId);

      const memberRow = host.page.locator(".team-member-row", { hasText: "github:e2e-rotation-removed" });
      await expect(memberRow).toBeVisible();
      await memberRow.getByRole("button", { name: "Remove" }).click();
      await expect(host.page.getByText(new RegExp(`Removed e2e-rotation-removed from ${room.teamName}`))).toBeVisible();

      await expect.poll(() => currentKeyEpoch(host.page, room.roomId)).toBeGreaterThan(epochBeforeRemoval);
      await expect(removed.page.getByPlaceholder(/access .* was removed on the relay/i)).toBeDisabled();
      const marker = `post-removal ${Date.now()}`;
      await sendRoomMessage(host.page, marker);
      await expect(removed.page.getByText(marker, { exact: true })).toHaveCount(0);
    } finally {
      await Promise.all([host.context.close(), removed.context.close()]);
    }
  });

  test("host handoff transfers the only active-host controls to the accepting member", async ({ browser }) => {
    const host = await openGuest(browser, "handoff-host");
    const successor = await openGuest(browser, "handoff-successor");
    try {
      const room = await createIsolatedRoom(host.page, "Host handoff");
      await requestInviteAccess(successor.page, await copyApprovalInvite(host.page));
      await approvePendingInvite(host.page, successor.page);

      await host.page.getByRole("button", { name: "Handoff", exact: true }).click();
      await expect(host.page.getByText(`${room.name} is ready for host handoff.`)).toBeVisible();
      await successor.page.getByRole("button", { name: "Room", exact: true }).click();
      const availableHandoff = successor.page.locator(".handoff-row.available");
      await expect(availableHandoff).toBeVisible();
      await availableHandoff.getByRole("button", { name: "Accept" }).click();

      await expect(successor.page.getByText(new RegExp(`You are now hosting ${room.name}`))).toBeVisible();
      await expect(successor.page.getByRole("button", { name: "Handoff", exact: true })).toBeEnabled();
      await expect(host.page.getByRole("button", { name: "Handoff", exact: true })).toBeDisabled();
      await expect(host.page.getByLabel("Codex host model", { exact: true })).toBeDisabled();
      await expect(successor.page.getByLabel("Codex host model", { exact: true })).toBeEnabled();
    } finally {
      await Promise.all([host.context.close(), successor.context.close()]);
    }
  });
});
