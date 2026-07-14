import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const appBinaryPath = resolve(
  "apps/desktop/src-tauri/target/debug/bundle/macos/multAIplayer.app/Contents/MacOS/multAIplayer"
);

export const config = {
  runner: "local",
  specs: ["./macos-smoke.e2e.mjs"],
  maxInstances: 1,
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        driverProvider: "embedded",
        embeddedPort: 4445,
        startTimeout: 90_000,
        statusPollTimeout: 5_000,
        captureBackendLogs: true,
        captureFrontendLogs: true
      }
    ]
  ],
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: appBinaryPath }
    }
  ],
  logLevel: "info",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 90_000 },
  onPrepare() {
    mkdirSync(resolve("reports/native-macos-smoke"), { recursive: true });
  }
};
