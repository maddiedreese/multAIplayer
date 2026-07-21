/* global describe, it, window, document, getComputedStyle */
import { browser, expect, $ } from "@wdio/globals";
import { mkdirSync, readFileSync } from "node:fs";

const expectedVersion = JSON.parse(
  readFileSync(new URL("../../apps/desktop/package.json", import.meta.url), "utf8")
).version;

const nativeInvoke = (command, args = {}) =>
  browser.execute(
    async (nativeCommand, nativeArgs) => window.__TAURI_INTERNALS__.invoke(nativeCommand, nativeArgs),
    command,
    args
  );

describe("packaged macOS WKWebView smoke", () => {
  it("loads the frontend, handles visible input, and completes real Tauri IPC", async () => {
    const welcomeVisible = await browser.execute(() =>
      [...document.querySelectorAll("h1")].some((heading) => heading.textContent?.trim() === "Work with Codex together")
    );
    if (welcomeVisible) {
      const welcome = await $("h1=Work with Codex together");
      await expect(welcome).toBeDisplayed();
      await expect(welcome).toBeFocused();
      await (await $("button=Explore the interface")).click();
    }

    const profileButton = await $("button=Profile");
    await expect(profileButton).toBeDisplayed();
    await profileButton.click();

    await expect($(".sidebar-drawer")).toBeDisplayed();
    await expect($(".sidebar-drawer span")).toHaveText("Account");

    const sidebarPresentation = await browser.execute(() => {
      const drawerSection = document.querySelector(".sidebar-drawer .drawer-section");
      const approvalSelect = document.querySelector(".codex-approval-mode select");
      const refreshButton = document.querySelector(".codex-account-panel .icon-button");
      const archiveInput = document.querySelector(".room-archive-panel input");
      const sidebar = document.querySelector(".sidebar");
      const sidebarScroll = document.querySelector(".sidebar-scroll");
      const footerButtons = [...document.querySelectorAll(".sidebar-footer button")];
      const originalTheme = document.documentElement.dataset.theme;
      const themes = Object.fromEntries(
        ["light", "dark"].map((theme) => {
          document.documentElement.dataset.theme = theme;
          const sectionStyle = getComputedStyle(drawerSection);
          const selectStyle = getComputedStyle(approvalSelect);
          return [
            theme,
            {
              sectionBackground: sectionStyle.backgroundColor,
              sectionColor: sectionStyle.color,
              selectAppearance: selectStyle.appearance,
              selectShadow: selectStyle.boxShadow,
              refreshAppearance: getComputedStyle(refreshButton).appearance,
              refreshShadow: getComputedStyle(refreshButton).boxShadow,
              refreshWidth: getComputedStyle(refreshButton).width,
              archiveInputAppearance: getComputedStyle(archiveInput).appearance,
              archiveInputShadow: getComputedStyle(archiveInput).boxShadow,
              drawerFont: sectionStyle.fontFamily,
              archiveInputFont: getComputedStyle(archiveInput).fontFamily
            }
          ];
        })
      );
      if (originalTheme) document.documentElement.dataset.theme = originalTheme;
      else delete document.documentElement.dataset.theme;
      return {
        themes,
        sidebarOverflow: getComputedStyle(sidebar).overflow,
        scrollOverflowY: getComputedStyle(sidebarScroll).overflowY,
        footerRows: new Set(footerButtons.map((button) => button.offsetTop)).size,
        footerButtonCount: footerButtons.length
      };
    });
    for (const theme of ["light", "dark"]) {
      const presentation = sidebarPresentation.themes[theme];
      expect(presentation.sectionColor).not.toBe(presentation.sectionBackground);
      expect(presentation.selectAppearance).toBe("none");
      expect(presentation.selectShadow).toBe("none");
      expect(presentation.refreshAppearance).toBe("none");
      expect(presentation.refreshShadow).toBe("none");
      expect(presentation.refreshWidth).toBe("32px");
      expect(presentation.archiveInputAppearance).toBe("none");
      expect(presentation.archiveInputShadow).toBe("none");
      expect(presentation.archiveInputFont).toBe(presentation.drawerFont);
    }
    expect(sidebarPresentation.sidebarOverflow).toBe("hidden");
    expect(sidebarPresentation.scrollOverflowY).toBe("auto");
    expect(sidebarPresentation.footerButtonCount).toBe(4);
    expect(sidebarPresentation.footerRows).toBe(1);

    const version = await nativeInvoke("app_version");
    expect(version).toBe(expectedVersion);

    const terminalProject = "/tmp/multaiplayer-native-terminal-smoke";
    mkdirSync(terminalProject, { recursive: true });
    const terminal = await nativeInvoke("terminal_start", {
      request: {
        roomId: "native-smoke-room",
        name: "shell",
        cwd: terminalProject,
        command: "exec zsh -f"
      }
    });
    await nativeInvoke("terminal_write", {
      request: {
        id: terminal.id,
        roomId: "native-smoke-room",
        input: "printf 'alpha17-terminal-ok\\n'\n"
      }
    });
    await browser.waitUntil(async () => {
      const snapshot = await nativeInvoke("terminal_read", { id: terminal.id });
      return snapshot.displayChunks
        .map((chunk) => chunk.text)
        .join("")
        .includes("alpha17-terminal-ok");
    });
    await nativeInvoke("terminal_stop", { id: terminal.id });

    const roomBrowserRequest = {
      roomId: "native-smoke-room",
      projectPath: "/tmp/multaiplayer-native-smoke",
      navigationId: "native-smoke-navigation",
      tabId: "native-smoke-tab",
      bounds: { x: 24, y: 80, width: 360, height: 240 }
    };
    await browser.execute(async (request) => {
      await window.__TAURI_INTERNALS__.invoke("open_browser_view", {
        request: { ...request, url: "https://example.com" }
      });
      await window.__TAURI_INTERNALS__.invoke("position_browser_view", {
        request: { ...request, bounds: { x: 32, y: 88, width: 380, height: 260 } }
      });
      await window.__TAURI_INTERNALS__.invoke("close_browser_view", { request });
    }, roomBrowserRequest);

    await browser.saveScreenshot("reports/native-macos-smoke/wkwebview-smoke.png");
  });
});
