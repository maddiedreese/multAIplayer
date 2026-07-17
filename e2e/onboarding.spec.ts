import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, expectNoAxeViolations, uiContractHarnessUrl, uiContractScenarioUrl } from "./helpers";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto(uiContractHarnessUrl);
  await page.evaluate(() => localStorage.clear());
  await page.goto(uiContractScenarioUrl("onboarding"));
  await expect(page.getByLabel("E2E coverage boundary")).toContainText("MLS invite verification and host approval");
});

test("welcome gives keyboard-equivalent create and join paths", async ({ page }) => {
  const heading = page.getByRole("heading", { name: "Work with Codex together" });
  await expect(heading).toBeFocused();
  await expect(page.getByRole("button", { name: /Create a workspace/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Join with an invite/ })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Create a workspace/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Check this device" })).toBeFocused();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: /Join with an invite/ }).click();
  await expect(page.getByRole("heading", { name: "Check this device" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Explore persists a resumable checklist and Help can reopen or reset setup", async ({ page }) => {
  await page.getByRole("button", { name: "Explore the interface" }).click();
  await expect(page.getByRole("complementary", { name: "Finish setup" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Finish setup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Work with Codex together" })).toHaveCount(0);

  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("complementary", { name: "Help panel" })).toContainText(
    "Setup progress stays only on this device"
  );
  await page.getByRole("button", { name: "Open setup guide" }).click();
  await expect(page.getByRole("heading", { name: "Work with Codex together" })).toBeVisible();
  await page.getByRole("button", { name: "Explore the interface" }).click();
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("button", { name: "Restart setup guide" }).click();
  await expect(page.getByRole("heading", { name: "Work with Codex together" })).toBeVisible();
});

test("readiness blocks progress until direct repair actions succeed", async ({ page }) => {
  await page.getByRole("button", { name: /Create a workspace/ }).click();
  const continueButton = page.getByRole("button", { name: /Continue/ });
  await expect(continueButton).toBeDisabled();
  await expect(page.getByText(/GitHub.*identity is required for hosted workspaces/)).toBeVisible();
  await expect(page.getByText(/Optional pull-request and Actions workflows ask for repo access later/)).toBeVisible();
  await expect(page.getByText(/ChatGPT.*authorizes the local Codex process/)).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(continueButton).toBeDisabled();
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeFocused();
  await expect(page.getByLabel("Workspace name")).toBeVisible();
  await expect(page.getByLabel("First room name")).toHaveValue("general");
  await expect(page.getByRole("textbox", { name: "Project folder" })).toHaveValue("/tmp/multaiplayer-onboarding");
});

test("partial team creation retries only the room and reaches the safe-default screen", async ({ page }) => {
  await page.getByRole("button", { name: /Create a workspace/ }).click();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Workspace name").fill("Core team");
  await page.getByRole("button", { name: /Create workspace/ }).click();
  await expect(page.getByRole("heading", { name: "Finish your first room" })).toBeVisible();
  await expect(page.getByText(/without creating another workspace/)).toBeVisible();
  await page.getByRole("button", { name: /Retry room setup/ }).click();

  await expect(page.getByRole("heading", { name: "Start with safe defaults" })).toBeVisible();
  await expect(page.getByText("Ask before every Codex turn")).toBeVisible();
  await expect(page.getByText("Workspace-write sandbox")).toBeVisible();
  await expect(page.getByText("Raw reasoning sharing off")).toBeVisible();
  await expect(page.getByText("Browser access restricted")).toBeVisible();
  await expect(page.getByText("Local history")).toBeVisible();
  await expect(page.getByTestId("create-counts")).toHaveCount(0);
  await page.getByRole("button", { name: /Enter room/ }).click();
  await expect(page.getByTestId("create-counts")).toHaveText("Team creates: 1; room creates: 2");
});

test("join waits for host device verification without optimistic unlock", async ({ page }) => {
  await page.getByRole("button", { name: /Join with an invite/ }).click();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Invite link or code").fill("multaiplayer://invite/example");
  await page.getByRole("button", { name: /Accept invite/ }).click();
  await expect(page.getByRole("status")).toContainText("Device verification required");
  await expect(page.getByRole("button", { name: "Waiting…" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Start with safe defaults" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Invite link or code" })).toBeVisible();
});

test("guided starter fills the real draft contract without sending", async ({ page }) => {
  await page.getByRole("button", { name: /Create a workspace/ }).click();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Workspace name").fill("Core team");
  await page.getByRole("button", { name: /Create workspace/ }).click();
  await page.getByRole("button", { name: /Retry room setup/ }).click();
  await page.getByRole("button", { name: /Enter room/ }).click();
  await page.getByRole("button", { name: "Explain the structure of this project." }).click();
  await expect(page.getByLabel("First-turn draft")).toHaveValue("Explain the structure of this project.");
  await expect(page.getByTestId("send-count")).toHaveText("Sent turns: 0");
});
