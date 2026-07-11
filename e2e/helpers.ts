import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { RelayEnvelope } from "@multaiplayer/protocol";

export const appUrl = "http://127.0.0.1:1421";
export const relayUrl = "http://127.0.0.1:4322";

export interface TestIdentity {
  id: string;
  login: string;
  name: string;
}

export const hostIdentity: TestIdentity = {
  id: "github:maddiedreese",
  login: "maddiedreese",
  name: "Maddie"
};

const relayEnvelopeQueues = new WeakMap<Page, RelayEnvelope[]>();
const relayEnvelopeWaiters = new WeakMap<Page, Array<(envelope: RelayEnvelope) => void>>();

export function attachPageDiagnostics(page: Page): void {
  relayEnvelopeQueues.set(page, []);
  relayEnvelopeWaiters.set(page, []);
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      try {
        const message = JSON.parse(payload) as { type?: string; envelope?: RelayEnvelope };
        if (message.type !== "envelope" || !message.envelope) return;
        const waiter = relayEnvelopeWaiters.get(page)?.shift();
        if (waiter) waiter(message.envelope);
        else relayEnvelopeQueues.get(page)?.push(message.envelope);
      } catch {
        // Ignore non-JSON frames; only production relay envelopes are retained.
      }
    });
  });
  page.on("pageerror", (error) => console.error(`[browser page error] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });
  page.on("requestfailed", (request) =>
    console.error(`[browser request failed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`)
  );
}

export async function nextRelayEnvelope(
  page: Page,
  kind: RelayEnvelope["kind"],
  predicate: (envelope: RelayEnvelope) => boolean = () => true
): Promise<RelayEnvelope> {
  const queue = relayEnvelopeQueues.get(page) ?? [];
  const queuedIndex = queue.findIndex((envelope) => envelope.kind === kind && predicate(envelope));
  if (queuedIndex >= 0) return queue.splice(queuedIndex, 1)[0]!;
  return new Promise((resolve) => {
    const waitForKind = (envelope: RelayEnvelope) => {
      if (envelope.kind === kind && predicate(envelope)) resolve(envelope);
      else {
        relayEnvelopeQueues.get(page)?.push(envelope);
        relayEnvelopeWaiters.get(page)?.push(waitForKind);
      }
    };
    relayEnvelopeWaiters.get(page)?.push(waitForKind);
  });
}

export async function authenticateContext(
  context: BrowserContext,
  identity: TestIdentity = hostIdentity
): Promise<void> {
  const response = await fetch(`${relayUrl}/debug/auth-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(identity)
  });
  expect(response.status).toBe(201);
  const sessionCookie = response.headers.get("set-cookie")?.match(/multaiplayer_session=([^;]+)/)?.[1];
  expect(sessionCookie).toBeTruthy();
  await context.addCookies([
    { name: "multaiplayer_session", value: sessionCookie!, url: relayUrl, httpOnly: true, sameSite: "Lax" }
  ]);
}

export async function openApp(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  attachPageDiagnostics(page);
  await page.goto(appUrl);
  await expect(page.getByText("Development web preview")).toBeVisible();
  return page;
}

export async function createRoom(page: Page, name: string): Promise<void> {
  const newRoom = page.getByRole("button", { name: "New room", exact: true });
  await newRoom.scrollIntoViewIfNeeded();
  await newRoom.click({ force: true });
  await page.getByPlaceholder("Room name").fill(name);
  const projectPath = page.locator(".room-create-form input").nth(1);
  if (!(await projectPath.inputValue())) await projectPath.fill("/tmp/multaiplayer-e2e");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("textbox", { name: "Room title" })).toHaveValue(name);
}

export async function copyApprovalInvite(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.getByRole("button", { name: "Copy room invite" }).click();
  await expect(page.getByText(/Copied invite link/)).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

export async function requestInviteAccess(page: Page, invite: string): Promise<void> {
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.locator('textarea[placeholder="Paste a multAIplayer invite..."]:visible').fill(invite);
  await page.locator("button:visible", { hasText: "Import invite" }).click();
}

export async function approvePendingInvite(host: Page, guest: Page): Promise<void> {
  const pendingRequest = host.locator(".terminal-request.pending").first();
  await expect(pendingRequest).toBeVisible();
  await pendingRequest.locator("button").first().click();
  await expect(host.getByText(/Approved .+'s join request/)).toBeVisible();
  await expect(guest.getByRole("textbox", { name: "Room title" })).not.toHaveValue("No room selected");
}

export async function sendRoomMessage(page: Page, message: string): Promise<void> {
  await page.getByPlaceholder(/Message the room/).fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
}
