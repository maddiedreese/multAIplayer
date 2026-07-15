import { expect, test } from "@playwright/test";
import { appUrl, attachPageDiagnostics } from "./helpers";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto(appUrl);
});

test("requires the native Apple silicon app without initializing a workspace", async ({ page }) => {
  await expect(page.getByTestId("native-app-required")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Apple silicon Macs/ })).toBeVisible();
  await expect(page.getByText(/This browser page does not contain a workspace/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
    "href",
    "https://multaiplayer.com/privacy"
  );
  await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
    "href",
    "https://multaiplayer.com/terms"
  );
  await expect(page.getByRole("button")).toHaveCount(0);
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
