import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { ConfigParser } from "@wdio/config/node";

const root = resolve(import.meta.dirname, "../..");

test("patched WebDriver dependencies load and preserve native journey configuration", async () => {
  // Import the consumers as well as the overridden browser package: this catches
  // removed ESM exports when upgrading the archive-download implementation.
  await import("@wdio/utils/node");
  await import("@wdio/tauri-service");
  const parser = new ConfigParser(resolve(root, "e2e/native-macos/wdio.conf.mjs"));
  await parser.initialize({ logLevel: "silent", connectionRetryCount: 2 });
  const config = parser.getConfig();
  assert.equal(config.logLevel, "silent");
  assert.equal(config.connectionRetryCount, 2);
  assert.equal(config.framework, "mocha");
  assert.equal(config.services[0][0], "@wdio/tauri-service");
  assert.equal(config.services[0][1].driverProvider, "embedded");
  assert.equal(parser.getCapabilities()[0].browserName, "tauri");
  assert.equal(parser.getSpecs().length, 1);
  assert.match(parser.getSpecs()[0], /macos-smoke\.e2e\.mjs$/);
});
