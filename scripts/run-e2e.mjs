import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const relayDataPath = join(tmpdir(), `multaiplayer-playwright-relay-${process.pid}.json`);
const playwrightCli = join(process.cwd(), "node_modules", "@playwright", "test", "cli.js");

rmSync(relayDataPath, { force: true });

const child = spawn(process.execPath, [playwrightCli, "test", "--config", "e2e/playwright.config.ts"], {
  env: { ...process.env, MULTAIPLAYER_E2E_RELAY_DATA_PATH: relayDataPath },
  stdio: "inherit"
});

child.on("error", (error) => {
  rmSync(relayDataPath, { force: true });
  throw error;
});

child.on("exit", (code, signal) => {
  rmSync(relayDataPath, { force: true });
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
