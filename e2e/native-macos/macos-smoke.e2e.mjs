/* global describe, it */
import { browser, expect, $ } from "@wdio/globals";

describe("packaged macOS WKWebView smoke", () => {
  it("loads the frontend, handles visible input, and completes real Tauri IPC", async () => {
    const profileButton = await $("button=Profile");
    await expect(profileButton).toBeDisplayed();
    await profileButton.click();

    await expect($(".sidebar-drawer")).toBeDisplayed();
    await expect($(".sidebar-drawer span")).toHaveText("Account");

    const version = await browser.tauri.execute(({ core }) => core.invoke("app_version"));
    expect(version).toBe("0.1.0-alpha.0");

    await browser.saveScreenshot("reports/native-macos-smoke/wkwebview-smoke.png");
  });
});
