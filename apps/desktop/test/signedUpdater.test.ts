import assert from "node:assert/strict";
import test from "node:test";
import { checkForSignedUpdate } from "../src/lib/platform/signedUpdater";

test("signed updater installs only through the verified Tauri resource and then relaunches", async () => {
  const events: string[] = [];
  const body = JSON.stringify({
    schema: "multaiplayer-updater-envelope-v1",
    payload: JSON.stringify({
      schema: "multaiplayer-updater-metadata-v1",
      version: "0.2.0",
      url: "https://github.com/maddiedreese/multAIplayer/releases/download/v0.2.0/multAIplayer-macos-arm64.app.tar.gz",
      archiveSignature: "signed archive",
      notes: "Bounded notes"
    }),
    signature: "verified by native comparator"
  });
  const handle = await checkForSignedUpdate(
    async () => ({
      version: "0.2.0",
      currentVersion: "0.1.0",
      body,
      async downloadAndInstall() {
        events.push("verified-install");
      },
      async close() {
        events.push("close");
      }
    }),
    async () => {
      events.push("relaunch");
    }
  );

  assert.equal(handle?.notice.latestVersion, "0.2.0");
  await handle?.install();
  assert.deepEqual(events, ["verified-install", "relaunch"]);
  await handle?.close();
  assert.deepEqual(events, ["verified-install", "relaunch", "close"]);
});

test("invalid updater metadata closes the native resource and is not offered", async () => {
  let closed = false;
  const handle = await checkForSignedUpdate(async () => ({
    version: "invalid",
    currentVersion: "0.1.0",
    async downloadAndInstall() {
      throw new Error("must not install");
    },
    async close() {
      closed = true;
    }
  }));
  assert.equal(handle, null);
  assert.equal(closed, true);
});
