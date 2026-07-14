/* global describe, it */
import { browser, expect, $ } from "@wdio/globals";

describe("packaged macOS WKWebView smoke", () => {
  it("loads the frontend, handles visible input, and completes real Tauri IPC", async () => {
    await browser.execute(() => localStorage.removeItem("multaiplayer:onboarding"));
    await browser.refresh();
    const welcome = await $("h1=Work with Codex together");
    await expect(welcome).toBeDisplayed();
    await expect(welcome).toBeFocused();
    await (await $("button=Explore the interface")).click();

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
