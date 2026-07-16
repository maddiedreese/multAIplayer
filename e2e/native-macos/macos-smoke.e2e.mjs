/* global describe, it */
import { browser, expect, $ } from "@wdio/globals";
import { readFileSync } from "node:fs";

const expectedVersion = JSON.parse(
  readFileSync(new URL("../../apps/desktop/package.json", import.meta.url), "utf8")
).version;

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
    expect(version).toBe(expectedVersion);

    await browser.saveScreenshot("reports/native-macos-smoke/wkwebview-smoke.png");
  });
});
