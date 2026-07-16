import { expect, test, type Page } from "@playwright/test";
import { attachPageDiagnostics, uiContractScenarioUrl } from "./helpers";

test("production Monaco bundle executes its offline language-service workers", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto(uiContractScenarioUrl("monaco-language-services"));

  await expect(page.getByRole("heading", { name: "Monaco language-service probes" })).toBeVisible();
  await expectCompletion(page, "/src/probe.ts", "charAt");
  await expectCompletion(page, "/src/probe.js", "charAt");

  const jsonProbe = probe(page, "/config/probe.json");
  await expect(jsonProbe.locator(".squiggly-error")).toHaveCount(1, { timeout: 20_000 });

  await expectCompletion(page, "/styles/probe.css", "display");
  await expectCompletion(page, "/views/probe.html", "button");
});

function probe(page: Page, path: string) {
  return page.locator(`[data-monaco-probe="${path}"]`);
}

async function expectCompletion(page: Page, path: string, expectedLabel: string) {
  const editor = probe(page, path).getByLabel(`Edit ${path}`);
  const input = probe(page, path).getByRole("textbox", { name: "Editor content" });
  await expect(editor.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
  await expect(editor.locator(".view-lines")).toBeVisible({ timeout: 20_000 });
  await expect(input).toBeAttached({ timeout: 20_000 });
  const suggestions = page.locator(".suggest-widget.visible");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await input.focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+Space");
    try {
      await expect(suggestions).toContainText(expectedLabel, { timeout: 7_000 });
      await page.keyboard.press("Escape");
      return;
    } catch {
      await page.keyboard.press("Escape");
    }
  }
  await expect(suggestions).toContainText(expectedLabel);
}
