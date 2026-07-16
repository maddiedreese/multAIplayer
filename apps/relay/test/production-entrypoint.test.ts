import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const relayRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

test("production entrypoint fails preflight before opening a listener", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", fileURLToPath(new URL("../src/production-entrypoint.ts", import.meta.url))],
    {
      cwd: relayRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        MULTAIPLAYER_RELAY_ALLOWED_ORIGINS: "",
        MULTAIPLAYER_RELAY_METRICS_TOKEN: "",
        MULTAIPLAYER_MLS_VALIDATOR_PATH: ""
      },
      encoding: "utf8",
      timeout: 10_000
    }
  );

  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0, output);
  assert.match(output, /Relay pre-deploy verification failed/);
  assert.doesNotMatch(output, /listening|readyz/);
});
