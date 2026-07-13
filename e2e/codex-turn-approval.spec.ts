import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, uiContractScenarioUrl } from "./helpers";

test.beforeEach(async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto(uiContractScenarioUrl("codex-turn-approval"));
  await expect(page.getByRole("heading", { name: "Codex turn approval" })).toBeVisible();
});

test("member proposal exposes a bounded preview while only the active host can start execution", async ({ page }) => {
  await page.getByRole("button", { name: "Propose Codex turn as Avery" }).click();

  await expect(page.getByTestId("proposal-notice")).toContainText("Avery proposed");
  await expect(page.getByText("host locked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(page.getByText(/2 earlier messages/)).toBeVisible();
  await expect(page.getByText(/NEWEST-CONTEXT-MARKER/)).toBeVisible();
  await expect(page.getByText(/OLDEST-CONTEXT-MARKER/)).toHaveCount(0);
  await expect(page.getByText(/2 earlier attachments/)).toBeVisible();
  await expect(page.getByText(/newest-visible-context\.md/)).toBeVisible();
  await expect(page.getByText(/oldest-hidden-context\.txt/)).toHaveCount(0);
  await expect(page.getByText("Workspace write", { exact: true })).toBeVisible();
  await expect(page.getByText(/terminal context/)).toBeVisible();
  await expect(page.getByText(/workspace\/Git context/)).toBeVisible();
  await expect(page.getByText(/browser context/)).toBeVisible();

  await page.getByRole("button", { name: "Active host view" }).click();
  await expect(page.getByText("host-side approval", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Approve", exact: true }).click();

  await expect(page.getByText("Approved Codex execution is running…")).toBeVisible();
  await expect(page.getByTestId("execution-count")).toHaveText("Native execution requests: 1");
  const inputBound = await page.getByTestId("codex-input-bound").innerText();
  const inputLengths = inputBound.match(/Bounded Codex input: (\d+) \/ (\d+) characters/);
  expect(inputLengths).not.toBeNull();
  expect(Number(inputLengths![1])).toBeLessThanOrEqual(Number(inputLengths![2]));
  expect(Number(inputLengths![2])).toBe(220_000);
  await expect(page.getByText("Codex execution completed.")).toBeVisible();
});

test("active-host denial clears the proposal without requesting execution", async ({ page }) => {
  await page.getByRole("button", { name: "Propose Codex turn as Avery" }).click();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(page.getByTestId("approval-phase")).toHaveText("pending");
  await expect(page.getByTestId("execution-count")).toHaveText("Native execution requests: 0");

  await page.getByRole("button", { name: "Active host view" }).click();
  await page.getByRole("button", { name: "Deny", exact: true }).click();

  await expect(page.getByText("Codex proposal denied without execution.")).toBeVisible();
  await expect(page.getByTestId("execution-count")).toHaveText("Native execution requests: 0");
  await expect(page.getByText("Approve Codex turn", { exact: true })).toHaveCount(0);
});
