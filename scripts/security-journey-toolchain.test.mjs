import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("security journey skips cleanly when Cargo is absent", () => {
  const childEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== "NODE_TEST_CONTEXT")
  );
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "--test",
      "--test-reporter=spec",
      "apps/relay/test/process-security-journey.test.ts"
    ],
    {
      cwd: process.cwd(),
      env: { ...childEnvironment, MULTAIPLAYER_CARGO_BIN: "/definitely/missing/multaiplayer-cargo" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /skipped: Rust toolchain required/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ENOENT/);
});
