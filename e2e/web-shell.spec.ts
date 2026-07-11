import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const appUrl = "http://127.0.0.1:1421";
const relayUrl = "http://127.0.0.1:4322";

function attachPageDiagnostics(page: Page): void {
  page.on("pageerror", (error) => console.error(`[browser page error] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });
  page.on("requestfailed", (request) =>
    console.error(`[browser request failed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`)
  );
}

test.beforeEach(({ page }) => attachPageDiagnostics(page));

async function openApp(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  attachPageDiagnostics(page);
  await page.goto(appUrl);
  await expect(page.getByText("Development web preview")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Room title" })).toHaveValue("Desktop app");
  return page;
}

async function authenticateContext(context: BrowserContext): Promise<void> {
  const response = await fetch(`${relayUrl}/debug/auth-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "github:maddiedreese", login: "maddiedreese", name: "Maddie" })
  });
  expect(response.status).toBe(201);
  const sessionCookie = response.headers.get("set-cookie")?.match(/multaiplayer_session=([^;]+)/)?.[1];
  expect(sessionCookie).toBeTruthy();
  await context.addCookies([
    { name: "multaiplayer_session", value: sessionCookie!, url: relayUrl, httpOnly: true, sameSite: "Lax" }
  ]);
}

async function createRoom(page: Page, name: string): Promise<void> {
  const newRoom = page.getByRole("button", { name: "New room", exact: true });
  await newRoom.scrollIntoViewIfNeeded();
  await newRoom.click({ force: true });
  await page.getByPlaceholder("Room name").fill(name);
  const projectPath = page.locator(".room-create-form input").nth(1);
  if (!(await projectPath.inputValue())) await projectPath.fill("/tmp/multaiplayer-e2e");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("textbox", { name: "Room title" })).toHaveValue(name);
}

async function copyApprovalInvite(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.getByRole("button", { name: "Copy room invite" }).click();
  await expect(page.getByText(/Copied invite link/)).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

async function requestInviteAccess(page: Page, invite: string): Promise<void> {
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.locator('textarea[placeholder="Paste a multAIplayer invite..."]:visible').fill(invite);
  await page.locator("button:visible", { hasText: "Import invite" }).click();
  await expect(page.getByText(/Requested access to/)).toBeVisible();
}

async function approvePendingInvite(host: Page, guest: Page): Promise<void> {
  const pendingRequest = host.locator(".terminal-request.pending").first();
  await expect(pendingRequest).toBeVisible();
  await pendingRequest.locator("button").first().click();
  await expect(host.getByText(/Approved .+'s join request/)).toBeVisible();
  await expect(guest.getByText(/approved your room join request.*unlocked/i)).toBeVisible();
}

test("loads the seeded workspace in the development web shell", async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByText("Development web preview")).toBeVisible();
  await expect(page.getByRole("button", { name: /Core Team 4 members/ })).toBeVisible();
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
