import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const relayDataPath = join(tmpdir(), `multaiplayer-playwright-relay-${process.pid}.sqlite`);
const playwrightCli = join(process.cwd(), "node_modules", "@playwright", "test", "cli.js");

function removeRelayData() {
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${relayDataPath}${suffix}`, { force: true });
}

removeRelayData();

const child = spawn(
  process.execPath,
  [playwrightCli, "test", "--config", "e2e/playwright.config.ts", ...process.argv.slice(2)],
  {
    env: { ...process.env, MULTAIPLAYER_E2E_RELAY_DATA_PATH: relayDataPath },
    stdio: "inherit"
  }
);

child.on("error", (error) => {
  removeRelayData();
  throw error;
});

child.on("exit", (code, signal) => {
  removeRelayData();
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
