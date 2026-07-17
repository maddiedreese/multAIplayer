import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assert, join, mkdtemp, rm, tmpdir } from "./support/relay.js";
import { createRelayPersistence } from "../src/persistence.js";

const execFileAsync = promisify(execFile);

test("stopped-relay device retirement removes only the selected device and its live KeyPackages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multaiplayer-device-retirement-test-"));
  const dataPath = join(dir, "relay.sqlite");
  const initial = createRelayPersistence({ dataPath });
  await initial.save({
    version: 1,
    savedAt: new Date().toISOString(),
    devices: [
      { userId: "github:user", deviceId: "retired", displayName: "Old" },
      { userId: "github:user", deviceId: "kept", displayName: "Current" },
      { userId: "github:other", deviceId: "retired", displayName: "Other user" }
    ],
    keyPackages: [
      { id: "old-kp", userId: "github:user", deviceId: "retired" },
      { id: "kept-kp", userId: "github:user", deviceId: "kept" },
      { id: "other-kp", userId: "github:other", deviceId: "retired" }
    ]
  });
  initial.close();
  try {
    const result = await runRetirementCli("github:user", "retired", dataPath);
    assert.match(result.stdout, /"removedDevices":1/);
    assert.match(result.stdout, /"removedKeyPackages":1/);

    const reopened = createRelayPersistence({ dataPath });
    const stored = (await reopened.load()) as {
      devices?: Array<{ userId: string; deviceId: string }>;
      keyPackages?: Array<{ id: string }>;
    };
    reopened.close();
    assert.deepEqual(stored.devices?.map(({ userId, deviceId }) => `${userId}:${deviceId}`).sort(), [
      "github:other:retired",
      "github:user:kept"
    ]);
    assert.deepEqual(stored.keyPackages?.map(({ id }) => id).sort(), ["kept-kp", "other-kp"]);

    await assert.rejects(runRetirementCli("github:user", "missing", dataPath), /does not exist/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("device retirement requires explicit stopped-writer and device confirmations", async () => {
  const script = fileURLToPath(new URL("../src/retire-device.ts", import.meta.url));
  await assert.rejects(
    execFileAsync(process.execPath, ["--import", "tsx", script, "github:user", "device", "--data-path=/tmp/unused"]),
    /confirm-relay-stopped/
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import",
      "tsx",
      script,
      "github:user",
      "device",
      "--data-path=/tmp/unused",
      "--confirm-relay-stopped",
      "--confirm-device-id=another-device"
    ]),
    /confirm-device-id must exactly match/
  );
});

test("device retirement does not create a store when the path is wrong", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multaiplayer-device-missing-store-test-"));
  const dataPath = join(dir, "missing.sqlite");
  try {
    await assert.rejects(runRetirementCli("github:user", "device", dataPath), /Relay store does not exist/);
    assert.equal(existsSync(dataPath), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("device retirement refuses a device that still holds room host authority", async () => {
  const dir = await mkdtemp(join(tmpdir(), "multaiplayer-device-host-test-"));
  const dataPath = join(dir, "relay.sqlite");
  const initial = createRelayPersistence({ dataPath });
  await initial.save({
    version: 1,
    savedAt: new Date().toISOString(),
    devices: [{ userId: "github:user", deviceId: "host-device", displayName: "Host" }],
    rooms: [
      {
        id: "hosted-room",
        hostUserId: "github:user",
        activeHostDeviceId: "host-device"
      }
    ]
  });
  initial.close();
  try {
    await assert.rejects(runRetirementCli("github:user", "host-device", dataPath), /still hosts room hosted-room/);
    const reopened = createRelayPersistence({ dataPath });
    const stored = (await reopened.load()) as { devices?: unknown[] };
    reopened.close();
    assert.equal(stored.devices?.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function runRetirementCli(userId: string, deviceId: string, dataPath: string) {
  return execFileAsync(process.execPath, [
    "--import",
    "tsx",
    fileURLToPath(new URL("../src/retire-device.ts", import.meta.url)),
    userId,
    deviceId,
    `--data-path=${dataPath}`,
    "--confirm-relay-stopped",
    `--confirm-device-id=${deviceId}`
  ]);
}
