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

  await capture(page, "onboarding", "onboarding.png");

  await page.getByRole("button", { name: /Create a workspace/ }).click();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Workspace name").fill("Launch team");
  await page.getByRole("button", { name: /Create workspace/ }).click();
  await page.getByRole("button", { name: /Retry room setup/ }).click();
  await settlePage(page);
  await captureFeature(page, "safe-defaults.png");

  await page.goto(scenarioUrl("codex-chat-parity"));
  await page.getByText("Codex worked", { exact: true }).click();
  await page.getByText("Thinking", { exact: true }).click();
  await settlePage(page);
  await captureFeature(page, "codex-room.png");
} finally {
  await browser?.close();
  await stopServer(server);
}

async function capture(page, scenario, filename) {
  await page.goto(scenarioUrl(scenario));
  await captureFeature(page, filename);
}

async function captureFeature(page, filename) {
  const feature = page.locator(".readme-feature");
  await feature.waitFor({ state: "visible" });
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
  await feature.screenshot({ path: `${output}/${filename}` });
}

async function settlePage(page) {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation: none !important; caret-color: transparent !important; transition: none !important; }"
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
