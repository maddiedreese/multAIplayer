import { expect, test } from "@playwright/test";
import {
  appUrl,
  approvePendingInvite,
  attachPageDiagnostics,
  authenticateContext,
  copyApprovalInvite,
  createRoom,
  openApp,
  requestInviteAccess,
  sendRoomMessage
} from "./helpers";

test.beforeEach(async ({ context, page }) => {
  attachPageDiagnostics(page);
  await authenticateContext(context);
});

test("loads without product demo content in the development web shell", async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByText("Development web preview")).toBeVisible();
  await expect(page.getByRole("button", { name: /Core Team/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Desktop app/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Relay ops/ })).toHaveCount(0);
});

test("creates and configures a room through the relay-backed web workspace", async ({ page }) => {
  await page.goto(appUrl);
  const roomName = `E2E room ${Date.now()}`;
  await createRoom(page, roomName);
  await expect(page.getByRole("textbox", { name: "Room title" })).toHaveValue(roomName);
  await page.getByRole("button", { name: "Host", exact: true }).click();
  const model = page.getByLabel("Codex host model");
  const reasoning = page.getByLabel("Codex reasoning");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/settings") && response.request().method() === "PATCH"),
    model.selectOption("gpt-5.5")
  ]);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/settings") && response.request().method() === "PATCH"),
    reasoning.selectOption("high")
  ]);
  await page.reload();
  await page.locator(".room-button.nested", { hasText: roomName }).click();
  await expect(page.getByLabel("Codex host model")).toHaveValue("gpt-5.5");
  await expect(page.getByLabel("Codex reasoning")).toHaveValue("high");
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await page.getByRole("button", { name: "New terminal" }).click();
  await expect(page.locator(".xterm")).toContainText("Preview mode: open the Tauri app for persistent host terminals.");
});

test("revoking room invites invalidates a previously copied capability", async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const guestContext = await browser.newContext();
  try {
    await authenticateContext(hostContext);
    await authenticateContext(guestContext, {
      id: "github:e2e-revoked-guest",
      login: "e2e-revoked-guest",
      name: "Revoked Guest"
    });
    const host = await openApp(hostContext);
    await createRoom(host, `Invite revocation ${Date.now()}`);
    await host.getByRole("button", { name: "Host", exact: true }).click();
    const oldInvite = await copyApprovalInvite(host);
    const revoked = await host.evaluate(async () => {
      const { useAppStore } = await import("/src/store/appStore.ts");
      const state = useAppStore.getState();
      const room = state.rooms.find((candidate) => candidate.id === state.selectedRoomId);
      if (!room) return false;
      const response = await fetch(`http://127.0.0.1:4322/teams/${room.teamId}/rooms/${room.id}/invites`, {
        method: "DELETE",
        credentials: "include"
      });
      return response.ok;
    });
    expect(revoked).toBe(true);

    const guest = await openApp(guestContext);
    await guest.getByRole("button", { name: "Room", exact: true }).click();
    await guest.locator('textarea[placeholder="Paste a multAIplayer invite..."]:visible').fill(oldInvite);
    await guest.locator("button:visible", { hasText: "Import invite" }).click();
    await expect(host.locator(".terminal-request.pending")).toHaveCount(0);
    await expect(guest.getByRole("textbox", { name: "Room title" })).not.toHaveValue(/Invite revocation/);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("an approved member receives encrypted chat while Codex approval stays with the host", async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const guestContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  try {
    await authenticateContext(hostContext);
    await authenticateContext(guestContext, {
      id: "github:e2e-chat-guest",
      login: "e2e-chat-guest",
      name: "Chat Guest"
    });
    const host = await openApp(hostContext);
    await createRoom(host, `Encrypted chat ${Date.now()}`);
    await host.getByRole("button", { name: "Host", exact: true }).click();
    const invite = await copyApprovalInvite(host);

    const guest = await openApp(guestContext);
    await requestInviteAccess(guest, invite);
    await approvePendingInvite(host, guest);
    const message = `encrypted hello ${Date.now()}`;
    await host.getByPlaceholder(/Message the room/).fill(message);
    await host.getByRole("button", { name: "Send message" }).click();
    await expect(guest.getByText(message, { exact: true })).toBeVisible();

    await sendRoomMessage(host, "Summarize the current room context.");
    await host.getByRole("button", { name: "Invoke Codex" }).click();

    const hostApproval = host.locator(".approval-card");
    await expect(hostApproval.getByText("host-side approval")).toBeVisible();
    await expect(hostApproval.getByRole("button", { name: "Approve" })).toBeEnabled();

    await sendRoomMessage(guest, "Add a contributor note.");
    await guest.getByRole("button", { name: "Invoke Codex" }).click();
    await expect(guest.getByText("Host will approve")).toBeVisible();
    await expect(guest.locator(".approval-card")).toHaveCount(0);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
