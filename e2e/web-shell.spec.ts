import { expect, test } from "@playwright/test";
import { appUrl, attachPageDiagnostics } from "./helpers";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto(appUrl);
});

test("shows a seeded local demo without initializing a relay workspace", async ({ page }) => {
  await expect(page.getByText("Local demo preview")).toBeVisible();
  await expect(page.getByTestId("web-preview-demo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome room" })).toBeVisible();
  await expect(page.getByText("Seeded local room")).toBeVisible();
  await expect(page.getByText("No relay connection")).toBeVisible();
  await expect(page.getByText(/This seeded room shows/)).toBeVisible();
});

test("disables relay, MLS, invite, and publish actions", async ({ page }) => {
  await expect(page.getByRole("button", { name: "New encrypted room" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Join with invite" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await expect(page.getByLabel("Demo message composer")).toBeDisabled();
  await expect(page.getByText(/cannot create, join, send to, or decrypt MLS rooms/)).toBeVisible();
});

test("does not persist or request private room material", async ({ page }) => {
  const storageKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(storageKeys.filter((key) => /device-identity|room-secret|history/.test(key))).toEqual([]);

  const resourceUrls = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => url.includes("127.0.0.1:4322"))
  );
  expect(resourceUrls).toEqual([]);
});
