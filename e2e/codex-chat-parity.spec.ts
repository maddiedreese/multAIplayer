import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, expectNoAxeViolations, uiContractScenarioUrl } from "./helpers";

test("chat renders both roles' code, generated images, and expandable Codex work", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto(uiContractScenarioUrl("codex-chat-parity"));

  await expect(page.getByText("const roomId = 'encrypted-room';")).toBeVisible();
  await expect(page.getByText("let shared = true;")).toBeVisible();
  await expect(page.getByRole("img", { name: "Codex-generated preview" })).toBeVisible();
  const followUpBehavior = page.getByRole("combobox", { name: "Codex follow-up behavior" });
  await expect(followUpBehavior).toHaveValue("steer");
  await expect(followUpBehavior.locator("option")).toHaveText(["Steer current turn", "Queue next turn"]);
  await followUpBehavior.selectOption("queue");
  await expect(followUpBehavior).toHaveValue("queue");
  await expectNoAxeViolations(page);

  await page.getByText("Codex worked", { exact: true }).click();
  await expect(page.getByText("Thinking")).toBeVisible();
  await page.getByText("Thinking").click();
  await expect(page.getByText("Checked the room boundary before editing.")).toBeVisible();
  await page.getByText("Raw reasoning shared with this room").click();
  await expect(page.getByText(/Provider-supplied raw reasoning/)).toBeVisible();

  await expect(page.getByText("Edited files")).toBeVisible();
  await expect(page.getByText("Spawned a subagent")).toBeVisible();
});
