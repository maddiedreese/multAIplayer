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
  const result = await checkForSignedUpdate(
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
    },
    async () => false
  );

  assert.equal(result.status, "available");
  if (result.status !== "available") throw new Error("expected an update handle");
  assert.equal(result.handle.notice.latestVersion, "0.2.0");
  await result.handle.install();
  assert.deepEqual(events, ["verified-install", "relaunch"]);
  await result.handle.close();
  assert.deepEqual(events, ["verified-install", "relaunch", "close"]);
});

test("invalid updater metadata closes the native resource and is not offered", async () => {
  let closed = false;
  const result = await checkForSignedUpdate(
    async () => ({
      version: "invalid",
      currentVersion: "0.1.0",
      async downloadAndInstall() {
        throw new Error("must not install");
      },
      async close() {
        closed = true;
      }
    }),
    async () => undefined,
    async () => false
  );
  assert.equal(result.status, "unverified");
  assert.equal(closed, true);
});

test("native metadata authentication rejection is distinct from no update", async () => {
  const observations = [false, true];
  const result = await checkForSignedUpdate(
    async () => null,
    async () => undefined,
    async () => observations.shift() ?? false
  );
  assert.equal(result.status, "unverified");
});

test("overlapping updater checks cannot consume one another's authentication signal", async () => {
  let authenticationFailureObserved = false;
  const firstCheckStarted = Promise.withResolvers<void>();
  const releaseFirstCheck = Promise.withResolvers<void>();
  const takeAuthFailure = async () => {
    const observed = authenticationFailureObserved;
    authenticationFailureObserved = false;
    return observed;
  };

  const first = checkForSignedUpdate(
    async () => {
      firstCheckStarted.resolve();
      await releaseFirstCheck.promise;
      return null;
    },
    async () => undefined,
    takeAuthFailure
  );
  await firstCheckStarted.promise;
  authenticationFailureObserved = true;

  const second = checkForSignedUpdate(
    async () => {
      authenticationFailureObserved = true;
      return null;
    },
    async () => undefined,
    takeAuthFailure
  );
  releaseFirstCheck.resolve();

  assert.equal((await first).status, "unverified");
  assert.equal((await second).status, "unverified");
});

test("an authenticated no-update response stays quiet", async () => {
  const result = await checkForSignedUpdate(
    async () => null,
    async () => undefined,
    async () => false
  );
  assert.equal(result.status, "up-to-date");
});
