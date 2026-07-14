import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const appUrl = "http://127.0.0.1:1421";
export const relayUrl = "http://127.0.0.1:4322";
export const uiContractHarnessUrl = "http://127.0.0.1:1422/e2e/harness/index.html";

export function uiContractScenarioUrl(scenario: string): string {
  return `${uiContractHarnessUrl}?scenario=${encodeURIComponent(scenario)}`;
}

export interface TestIdentity {
  id: string;
  login: string;
  name: string;
}

export interface AuthenticatedClient {
  context: BrowserContext;
  page: Page;
}

export const hostIdentity: TestIdentity = {
  id: "github:maddiedreese",
  login: "maddiedreese",
  name: "Maddie"
};

export function attachPageDiagnostics(page: Page): void {
  page.on("pageerror", (error) => console.error(`[browser page error] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });
  page.on("requestfailed", (request) =>
    console.error(`[browser request failed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`)
  );
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target)
  }));
  expect(summary, "axe found WCAG A/AA accessibility violations").toEqual([]);
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
  if (identity.id === hostIdentity.id) {
    const cookie = `multaiplayer_session=${sessionCookie}`;
    const workspaceResponse = await fetch(`${relayUrl}/teams`, { headers: { cookie } });
    expect(workspaceResponse.status).toBe(200);
    const workspace = (await workspaceResponse.json()) as { teams: Array<{ name: string }> };
    if (!workspace.teams.some((team) => team.name === "E2E Team")) {
      const teamResponse = await fetch(`${relayUrl}/teams`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "E2E Team" })
      });
      expect(teamResponse.status).toBe(201);
    }
  }
}

export async function openApp(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  attachPageDiagnostics(page);
  await page.goto(appUrl);
  await expect(page.getByTestId("native-app-required")).toBeVisible();
  return page;
}

export async function openAuthenticatedClient(
  browser: Browser,
  identity: TestIdentity = hostIdentity
): Promise<AuthenticatedClient> {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  await authenticateContext(context, identity);
  return { context, page: await openApp(context) };
}

export async function createRoom(page: Page, name: string, teamName = "E2E Team"): Promise<void> {
  const teamSelector = page.getByRole("combobox", { name: "Switch team" });
  const targetTeamId = await teamSelector.locator("option", { hasText: teamName }).getAttribute("value");
  expect(targetTeamId).toBeTruthy();
  if ((await teamSelector.isEnabled()) && (await teamSelector.inputValue()) !== targetTeamId) {
    await teamSelector.selectOption(targetTeamId!);
    await expect(teamSelector).toHaveValue(targetTeamId!);
  } else await expect(teamSelector).toHaveValue(targetTeamId!);
  const newRoom = page.getByRole("button", { name: "New room", exact: true });
  await newRoom.scrollIntoViewIfNeeded();
  await expect(newRoom).toBeEnabled();
  await newRoom.click();
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

export async function admitClient(host: Page, guest: Page): Promise<void> {
  const invite = await copyApprovalInvite(host);
  await requestInviteAccess(guest, invite);
  await approvePendingInvite(host, guest);
}

export async function sendRoomMessage(page: Page, message: string): Promise<void> {
  await page.getByPlaceholder(/Message the room/).fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
}
