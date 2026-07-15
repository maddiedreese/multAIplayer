import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../docs/assets/screens/", import.meta.url));
const port = 1423;
const baseUrl = `http://127.0.0.1:${port}/e2e/harness/index.html`;

await mkdir(output, { recursive: true });

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

  await capture(page, "onboarding", "onboarding.png", page.locator(".onboarding-shell"));

  await page.getByRole("button", { name: /Create a workspace/ }).click();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Workspace name").fill("Launch team");
  await page.getByRole("button", { name: /Create workspace/ }).click();
  await page.getByRole("button", { name: /Retry room setup/ }).click();
  await settlePage(page);
  await page.locator(".onboarding-shell").screenshot({ path: `${output}/safe-defaults.png` });

  await page.goto(scenarioUrl("codex-chat-parity"));
  await page.getByText("Codex worked", { exact: true }).click();
  await page.getByText("Thinking", { exact: true }).click();
  await settlePage(page);
  await page.locator(".e2e-chat-parity").screenshot({ path: `${output}/codex-room.png` });
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

async function capture(page, scenario, filename, locator) {
  await page.goto(scenarioUrl(scenario));
  await locator.waitFor({ state: "visible" });
  await settlePage(page);
  await locator.screenshot({ path: `${output}/${filename}` });
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
