import { expect, test } from "@playwright/test";
import {
  appUrl,
  approvePendingInvite,
  attachPageDiagnostics,
  authenticateContext,
  copyApprovalInvite,
  createRoom,
  openApp,
  requestInviteAccess
} from "./helpers";

test.beforeEach(async ({ context, page }) => {
  attachPageDiagnostics(page);
  await authenticateContext(context);
});

test("loads the seeded workspace in the development web shell", async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByText("Development web preview")).toBeVisible();
  await expect(page.getByRole("button", { name: /Core Team Owner · 4 members/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Room title" })).toHaveValue("Desktop app");
  await expect(page.getByRole("button", { name: /Relay ops MultAIplayer/ })).toBeVisible();
});

test("creates a room through the relay-backed workspace flow", async ({ page }) => {
  await page.goto(appUrl);
  const roomName = `E2E room ${Date.now()}`;
  await createRoom(page, roomName);
  await expect(page.getByRole("textbox", { name: "Room title" })).toHaveValue(roomName);
});

test("revoking room invites invalidates a previously copied capability", async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const guestContext = await browser.newContext();
  try {
    await authenticateContext(hostContext);
    await authenticateContext(guestContext);
    const host = await openApp(hostContext);
    await expect(host.getByRole("textbox", { name: "Room title" })).toHaveValue("Desktop app");
    const oldInvite = await copyApprovalInvite(host);
    const revoked = await host.evaluate(async () => {
      const response = await fetch("http://127.0.0.1:4322/teams/team-core/rooms/room-desktop/invites", {
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
    await expect(guest.getByText(/Invite could not be imported/)).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("an approved invite lets a second browser context receive encrypted chat", async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const guestContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  try {
    await authenticateContext(hostContext);
    await authenticateContext(guestContext);
    const host = await openApp(hostContext);
    await expect(host.getByRole("textbox", { name: "Room title" })).toHaveValue("Desktop app");
    const invite = await copyApprovalInvite(host);

    const guest = await openApp(guestContext);
    await requestInviteAccess(guest, invite);
    await approvePendingInvite(host, guest);
    const message = `encrypted hello ${Date.now()}`;
    await host.getByPlaceholder(/Message the room/).fill(message);
    await host.getByRole("button", { name: "Send message" }).click();
    await expect(guest.getByText(message, { exact: true })).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("an imported invite selects the shared room and records membership locally", async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const guestContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  try {
    await authenticateContext(hostContext);
    await authenticateContext(guestContext);
    const host = await openApp(hostContext);
    await expect(host.getByRole("textbox", { name: "Room title" })).toHaveValue("Desktop app");
    const roomName = "Desktop app";
    const invite = await copyApprovalInvite(host);
    const guest = await openApp(guestContext);
    await requestInviteAccess(guest, invite);
    await approvePendingInvite(host, guest);
    await expect(guest.getByRole("textbox", { name: "Room title" })).toHaveValue(roomName);
    await expect(guest.locator(".room-button.nested.active", { hasText: roomName })).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("only the active host can approve a pending Codex turn", async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const guestContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  try {
    await authenticateContext(hostContext);
    await authenticateContext(guestContext, {
      id: "github:e2e-codex-contributor",
      login: "e2e-codex-contributor",
      name: "Codex Contributor"
    });
    const host = await openApp(hostContext);
    const guest = await openApp(guestContext);
    await requestInviteAccess(guest, await copyApprovalInvite(host));
    await approvePendingInvite(host, guest);

    await host.getByRole("button", { name: "Invoke Codex" }).click();

    const hostApproval = host.locator(".approval-card");
    await expect(hostApproval.getByText("host-side approval")).toBeVisible();
    await expect(hostApproval.getByRole("button", { name: "Approve" })).toBeEnabled();

    await guest.getByRole("button", { name: "Invoke Codex" }).click();
    await expect(guest.getByText("Host will approve")).toBeVisible();
    await expect(guest.locator(".approval-card")).toHaveCount(0);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("room model and reasoning settings persist across reload", async ({ page }) => {
  await page.goto(appUrl);
  await page.getByRole("button", { name: /Desktop app MultAIplayer/ }).click();
  const model = page.getByLabel("Codex host model");
  const reasoning = page.getByLabel("Codex reasoning");
  await model.selectOption("gpt-5.5");
  await reasoning.selectOption("high");
  await expect(model).toHaveValue("gpt-5.5");
  await expect(reasoning).toHaveValue("high");
  await page.reload();
  await expect(page.getByLabel("Codex host model")).toHaveValue("gpt-5.5");
  await expect(page.getByLabel("Codex reasoning")).toHaveValue("high");
});

test("terminal clearly exposes the native-only fallback in web preview", async ({ page }) => {
  await page.goto(appUrl);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await page.getByRole("button", { name: "New terminal" }).click();
  await expect(page.locator(".xterm")).toContainText("Preview mode: open the Tauri app for persistent host terminals.");
});
