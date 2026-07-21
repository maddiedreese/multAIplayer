#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../docs/assets/screens/", import.meta.url));
const port = 1423;
const baseUrl = `http://127.0.0.1:${port}/e2e/harness/index.html`;
const expectedCaptureGeometry = new Map([
  ["room-chat.png", { width: 760, minHeight: 390, maxHeight: 400 }],
  ["room-browser.png", { width: 760, minHeight: 360, maxHeight: 360 }],
  ["room-terminal.png", { width: 760, minHeight: 400, maxHeight: 465 }],
  ["room-app.png", { width: 1200, minHeight: 700, maxHeight: 700 }]
]);

await mkdir(output, { recursive: true });
const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) throw new Error("npm run docs:screenshots must be launched through npm.");
await execFileAsync(process.execPath, [npmExecPath, "run", "build:packages"], { cwd: root });

const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--config",
    "e2e/harness/vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(port)
  ],
  { cwd: root, stdio: ["ignore", "pipe", "inherit"] }
);
let browser;

try {
  await waitForServer(server);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  await capture(page, "readme-chat", "room-chat.png");
  await capture(page, "readme-browser", "room-browser.png");
  await capture(page, "readme-terminal", "room-terminal.png");
  await capture(page, "readme-app", "room-app.png");
} finally {
  await browser?.close();
  await stopServer(server);
}

async function capture(page, scenario, filename) {
  await page.goto(scenarioUrl(scenario));
  await captureFeature(page, filename);
}

async function captureFeature(page, filename) {
  const feature = page.locator("[data-readme-capture]");
  await feature.waitFor({ state: "visible" });
  if (filename === "room-browser.png") {
    const address = feature.getByRole("textbox", { name: "Browser URL" });
    if ((await address.inputValue()) !== "") throw new Error("README browser capture must use an empty address bar.");
    if ((await feature.getByRole("tab").count()) !== 0)
      throw new Error("README browser capture must not include named tabs.");
    if ((await feature.locator("iframe").count()) !== 0)
      throw new Error("README browser capture must not include preview content.");
  }
  if (filename === "room-terminal.png") {
    await feature.locator(".xterm").waitFor({ state: "visible" });
    const terminalOutput = (await feature.locator(".xterm-rows").textContent())?.trim() ?? "";
    if (terminalOutput !== "") throw new Error("README terminal capture must not include session output.");
  }
  if (filename === "room-app.png") {
    await feature.getByLabel("Codex activity timeline").waitFor({ state: "visible" });
    if ((await feature.getByLabel("Room title").inputValue()) !== "Launch") {
      throw new Error("README full-app capture must show the active production room.");
    }
    if ((await feature.getByText("Welcome to multAIplayer").count()) !== 0) {
      throw new Error("README full-app capture must not include onboarding.");
    }
  }
  await settlePage(page);
  const dimensions = await feature.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth
  }));
  if (dimensions.scrollHeight !== dimensions.clientHeight || dimensions.scrollWidth !== dimensions.clientWidth) {
    throw new Error(`README feature ${filename} overflows its capture surface: ${JSON.stringify(dimensions)}`);
  }
  const expectedGeometry = expectedCaptureGeometry.get(filename);
  const captureGeometry = await feature.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    width: element.getBoundingClientRect().width
  }));
  if (
    !expectedGeometry ||
    captureGeometry.width !== expectedGeometry.width ||
    captureGeometry.height < expectedGeometry.minHeight ||
    captureGeometry.height > expectedGeometry.maxHeight
  ) {
    throw new Error(
      `README feature ${filename} has unexpected capture geometry: ${JSON.stringify({ captureGeometry, expectedGeometry })}`
    );
  }
  if (filename === "room-app.png") {
    const fullAppGeometry = await feature.evaluate((element) => {
      const shell = element.querySelector(".app-shell");
      return {
        shellHeight: shell?.clientHeight ?? 0,
        shellWidth: shell?.clientWidth ?? 0
      };
    });
    if (
      fullAppGeometry.shellWidth !== dimensions.clientWidth ||
      fullAppGeometry.shellHeight !== dimensions.clientHeight
    ) {
      throw new Error(`README full-app capture has unexpected shell geometry: ${JSON.stringify(fullAppGeometry)}`);
    }
  }
  await feature.screenshot({ path: `${output}/${filename}`, omitBackground: true });
}

async function settlePage(page) {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation: none !important; caret-color: transparent !important; transition: none !important; } .xterm-helper-textarea, .xterm-cursor { opacity: 0 !important; }"
  });
  await page.evaluate(() => globalThis.document.fonts.ready);
}

function scenarioUrl(name) {
  return `${baseUrl}?scenario=${encodeURIComponent(name)}&presentation=readme`;
}

async function waitForServer(child) {
  let outputText = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    outputText += chunk;
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${outputText}`);
    try {
      // The screenshot server is a temporary Vite process bound to 127.0.0.1 for this local harness only.
      // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for the README capture server.\n${outputText}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  let timeoutId;
  const timedOut = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, 5_000, "timeout");
  });
  const outcome = await Promise.race([exited, timedOut]);
  clearTimeout(timeoutId);
  if (outcome === "timeout" && child.exitCode === null) {
    const forcedExit = once(child, "exit");
    child.kill("SIGKILL");
    await forcedExit;
  }
}
