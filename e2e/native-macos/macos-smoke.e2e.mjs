/* global describe, it, window, document, getComputedStyle */
import { browser, expect, $ } from "@wdio/globals";
import { mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const expectedVersion = JSON.parse(
  readFileSync(new URL("../../apps/desktop/package.json", import.meta.url), "utf8")
).version;
const expectedLoginShell = execFileSync("/usr/bin/id", ["-P", String(process.getuid())], {
  encoding: "utf8"
})
  .trim()
  .split(":")
  .at(-1);

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

    await browser.execute(() => {
      if (document.querySelector(".sidebar-drawer")) return;
      [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Profile")?.click();
    });
    await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".sidebar-drawer"))));
    const profileText = await browser.execute(() => document.querySelector(".sidebar-drawer")?.textContent ?? "");
    expect(profileText).not.toContain("Apps (");
    expect(profileText).not.toContain("MCP servers (");

    const sidebarPresentation = await browser.execute(() => {
      const drawerSection = document.querySelector(".sidebar-drawer .drawer-section");
      const refreshButton = document.querySelector(".codex-account-panel .icon-button");
      const archiveInput = document.querySelector(".room-archive-panel input");
      const sidebar = document.querySelector(".sidebar");
      const sidebarScroll = document.querySelector(".sidebar-scroll");
      const footerButtons = [...document.querySelectorAll(".sidebar-footer button")];
      const drawerParagraphs = [...document.querySelectorAll(".sidebar-drawer p")];
      const originalTheme = document.documentElement.dataset.theme;
      const themes = Object.fromEntries(
        ["light", "dark"].map((theme) => {
          document.documentElement.dataset.theme = theme;
          const sectionStyle = getComputedStyle(drawerSection);
          return [
            theme,
            {
              sectionBackground: sectionStyle.backgroundColor,
              sectionColor: sectionStyle.color,
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
        footerButtonCount: footerButtons.length,
        paragraphFontSizes: drawerParagraphs.map((paragraph) => getComputedStyle(paragraph).fontSize),
        paragraphFonts: drawerParagraphs.map((paragraph) => getComputedStyle(paragraph).fontFamily)
      };
    });
    for (const theme of ["light", "dark"]) {
      const presentation = sidebarPresentation.themes[theme];
      expect(presentation.sectionColor).not.toBe(presentation.sectionBackground);
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
    expect(new Set(sidebarPresentation.paragraphFontSizes)).toEqual(new Set(["13px"]));
    expect(new Set(sidebarPresentation.paragraphFonts).size).toBeLessThanOrEqual(1);
    await browser.saveScreenshot("reports/native-macos-smoke/profile.png");

    await browser.execute(() => document.querySelector('button[aria-label="Close panel"]')?.click());
    const hasRoomControlsToggle = await browser.execute(() => Boolean(document.querySelector(".room-controls-toggle")));
    if (hasRoomControlsToggle) {
      for (let index = 0; index < 4; index += 1) {
        const state = await browser.execute(() => {
          const toggle = document.querySelector(".room-controls-toggle");
          const before = toggle?.getAttribute("aria-expanded");
          toggle?.click();
          return { before, after: toggle?.getAttribute("aria-expanded") };
        });
        expect(state.after).toBe(state.before === "true" ? "false" : "true");
      }
    }

    await browser.execute(() =>
      [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Help")?.click()
    );
    await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".help-drawer-panel"))));
    const helpTypography = await browser.execute(() => {
      const paragraphs = [...document.querySelectorAll(".help-drawer-panel p")];
      return paragraphs.map((paragraph) => ({
        font: getComputedStyle(paragraph).fontFamily,
        size: getComputedStyle(paragraph).fontSize,
        lineHeight: getComputedStyle(paragraph).lineHeight
      }));
    });
    expect(new Set(helpTypography.map(({ font }) => font)).size).toBe(1);
    expect(new Set(helpTypography.map(({ size }) => size))).toEqual(new Set(["13px"]));
    await browser.saveScreenshot("reports/native-macos-smoke/help.png");
    await browser.execute(() => document.querySelector('button[aria-label="Close panel"]')?.click());

    const version = await nativeInvoke("app_version");
    expect(version).toBe(expectedVersion);

    const terminalProject = process.env.NATIVE_SMOKE_PROJECT_PATH || "/tmp/multaiplayer-native-terminal-smoke";
    mkdirSync(terminalProject, { recursive: true });
    const projectFiles = await nativeInvoke("project_files", {
      request: { cwd: terminalProject, query: "", limit: 80 }
    });
    expect(Array.isArray(projectFiles)).toBe(true);
    const terminal = await nativeInvoke("terminal_start", {
      request: {
        roomId: "native-smoke-room",
        name: "shell",
        cwd: terminalProject,
        command: "interactive-login-shell"
      }
    });
    await nativeInvoke("terminal_write", {
      request: {
        id: terminal.id,
        roomId: "native-smoke-room",
        input: "printf '%s\\n' terminal-output-visible; printf '__multAIplayer_shell__%s\\n' \"$SHELL\"\n"
      }
    });
    await browser.waitUntil(async () => {
      const snapshot = await nativeInvoke("terminal_read", { id: terminal.id });
      const display = snapshot.displayChunks.map((chunk) => chunk.text).join("");
      return (
        display.match(/terminal-output-visible/g)?.length >= 2 &&
        display.includes(`__multAIplayer_shell__${expectedLoginShell}`)
      );
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
