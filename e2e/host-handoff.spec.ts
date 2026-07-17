import { expect, test } from "@playwright/test";
import { attachPageDiagnostics, uiContractScenarioUrl } from "./helpers";

test("host handoff requires a member request and explicit host approval before controls transfer", async ({ page }) => {
  attachPageDiagnostics(page);
  await page.goto(uiContractScenarioUrl("host-handoff"));

  const boundary = page.getByRole("complementary", { name: "UI contract coverage boundary" });
  await expect(boundary).toContainText("UI contract harness");
  await expect(boundary).toContainText("native MLS host-transfer commit");

  const initiator = page.getByTestId("initiator-client");
  const successor = page.getByTestId("successor-client");
  const initiatorHandoff = initiator.getByRole("button", { name: "Handoff", exact: true });
  const successorHandoff = successor.getByRole("button", { name: "Handoff", exact: true });
  const initiatorModel = initiator.getByRole("combobox", { name: "Codex host model" });
  const successorModel = successor.getByRole("combobox", { name: "Codex host model" });

  await expect(initiatorHandoff).toBeEnabled();
  await expect(initiatorModel).toBeEnabled();
  await expect(successorHandoff).toBeDisabled();
  await expect(successorModel).toBeDisabled();

  await initiatorHandoff.click();
  await expect(successor.locator(".handoff-row.available")).toBeVisible();
  await successor.getByRole("button", { name: "Request handoff" }).click();

  await expect(successor.getByRole("status")).toHaveText(
    "Host authority request sent. The active host must explicitly approve it."
  );
  await expect(initiator.getByRole("status")).toContainText("active host must approve the MLS transfer");
  await expect(initiator.locator(".handoff-row.requested")).toBeVisible();
  await expect(successorHandoff).toBeDisabled();
  await expect(successorModel).toBeDisabled();

  await initiator.getByRole("button", { name: "Approve candidate" }).click();

  await expect(initiator.getByRole("status")).toContainText("host authority transfer committed");
  await expect(successor.getByRole("status")).toContainText("You are now hosting Host handoff room");
  await expect(initiator.locator(".handoff-row.accepted")).toBeVisible();
  await expect(successor.locator(".handoff-row.accepted")).toBeVisible();
  await expect(initiatorHandoff).toBeDisabled();
  await expect(initiatorModel).toBeDisabled();
  await expect(successorHandoff).toBeEnabled();
  await expect(successorModel).toBeEnabled();
});
