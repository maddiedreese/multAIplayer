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

    const roomBrowserRequest = {
      roomId: "native-smoke-room",
      projectPath: "/tmp/multaiplayer-native-smoke",
      bounds: { x: 24, y: 80, width: 360, height: 240 }
    };
    await browser.tauri.execute(
      ({ core }, request) =>
        core.invoke("open_browser_view", {
          request: { ...request, url: "https://example.com" }
        }),
      roomBrowserRequest
    );
    await browser.tauri.execute(
      ({ core }, request) =>
        core.invoke("position_browser_view", {
          request: { ...request, bounds: { x: 32, y: 88, width: 380, height: 260 } }
        }),
      roomBrowserRequest
    );
    await browser.tauri.execute(
      ({ core }, request) => core.invoke("close_browser_view", { request }),
      roomBrowserRequest
    );

    await browser.saveScreenshot("reports/native-macos-smoke/wkwebview-smoke.png");
  });
});
