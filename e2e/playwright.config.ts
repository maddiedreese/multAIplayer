import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:1421",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command: "npm run build:packages && npm run dev",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      MULTAIPLAYER_RELAY_DEBUG: "true",
      MULTAIPLAYER_RELAY_REQUIRE_AUTH: "true",
      MULTAIPLAYER_RELAY_DATA_PATH:
        process.env.MULTAIPLAYER_E2E_RELAY_DATA_PATH ?? "/tmp/multaiplayer-playwright-relay.json",
      PORT: "4322",
      VITE_DESKTOP_PORT: "1421",
      VITE_RELAY_HTTP_URL: "http://127.0.0.1:4322",
      VITE_RELAY_URL: "ws://127.0.0.1:4322/rooms"
    }
  }
});
