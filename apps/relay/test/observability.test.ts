import assert from "node:assert/strict";
import test from "node:test";
import { logRelayEvent } from "../src/observability.js";

test("relay operational logs are structured and contain only explicit safe fields", () => {
  const lines: string[] = [];
  logRelayEvent(
    "warn",
    "invalid_configuration_ignored",
    { setting: "storage", minimumCharacters: 32, service: "untrusted-override" },
    (line) => lines.push(line)
  );
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(record.service, "multaiplayer-relay");
  assert.equal(record.level, "warn");
  assert.equal(record.event, "invalid_configuration_ignored");
  assert.equal(record.setting, "storage");
  assert.equal(record.minimumCharacters, 32);
  assert.match(String(record.at), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.stringify(record).includes("credential"), false);
});
