import { expect, test, type Locator, type Page } from "@playwright/test";
import { attachPageDiagnostics, expectNoAxeViolations, uiContractScenarioUrl } from "./helpers";

async function requestAccess(page: Page): Promise<{ host: Locator; guest: Locator; pendingRequest: Locator }> {
  attachPageDiagnostics(page);
  await page.goto(uiContractScenarioUrl("invite-join"));

  const boundary = page.getByRole("complementary", { name: "E2E coverage boundary" });
  await expect(boundary).toContainText("UI-contract E2E harness");
  await expect(boundary).toContainText("native MLS KeyPackage, HPKE, commit, and Welcome processing");

  const host = page.getByRole("region", { name: "Host client" });
  const guest = page.getByRole("region", { name: "Guest client" });
  await host.getByRole("button", { name: "Copy room invite" }).click();
  const invite = await host.locator(".invite-link").textContent();
  expect(invite).toBeTruthy();

  await guest.getByPlaceholder("Paste a multAIplayer invite...").fill(invite!);
  await guest.getByRole("button", { name: "Import invite" }).click();

  const pendingRequest = host.locator(".terminal-request.pending");
  await expect(pendingRequest).toContainText("E2E Guest");
  await expect(pendingRequest).toContainText("Requesting access to UI Contract Room.");
  await expect(guest.getByPlaceholder(/Host approval is required/)).toBeDisabled();
  await expect(guest.getByRole("button", { name: "Send message" })).toBeDisabled();
  await expectNoAxeViolations(page);
  return { host, guest, pendingRequest };
}

test("invite import stays locked until the host explicitly approves the requesting device", async ({ page }) => {
  const { host, guest, pendingRequest } = await requestAccess(page);

  await pendingRequest.getByRole("button").first().click();
  await expect(host.getByText("Approved E2E Guest's MLS KeyPackage.")).toBeVisible();
  await expect(guest.getByText("The host approved this device. UI Contract Room is now unlocked.")).toBeVisible();
  await expect(guest.getByPlaceholder(/Message the room/)).toBeEnabled();
  await expect(guest.locator(".terminal-request.approved")).toContainText("approved");
});

test("an explicit host denial leaves the requesting device locked", async ({ page }) => {
  const { host, guest, pendingRequest } = await requestAccess(page);

  await pendingRequest.getByRole("button").nth(1).click();
  await expect(host.getByText("Denied E2E Guest's join request.")).toBeVisible();
  await expect(guest.getByText("The host denied access to UI Contract Room.")).toBeVisible();
  await expect(guest.getByPlaceholder(/Host approval is required/)).toBeDisabled();
  await expect(guest.getByRole("button", { name: "Send message" })).toBeDisabled();
  await expect(guest.locator(".terminal-request.denied")).toContainText("denied");
});
