import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, uiContractScenarioUrl } from "./helpers";

test("raw provider reasoning is an explicit off-by-default room sharing choice", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto(uiContractScenarioUrl("raw-reasoning-setting"));

  const setting = page.getByRole("checkbox", { name: /Share raw provider reasoning/ });
  await expect(setting).not.toBeChecked();
  await expect(page.getByText(/shared with and retained by every room member/)).toBeVisible();
  await setting.check();
  await expect(page.getByRole("status")).toHaveText("Raw reasoning sharing is enabled for future room activity.");
});
