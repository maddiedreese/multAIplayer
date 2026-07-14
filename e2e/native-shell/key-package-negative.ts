import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Browser } from "webdriverio";

interface NativeKeyPackageUpload {
  id: string;
  keyPackage: string;
  keyPackageHash: string;
  ciphersuite: number;
}

async function generateNativeKeyPackage(browser: Browser): Promise<NativeKeyPackageUpload> {
  return browser
    .executeAsync((done) => {
      import("/src/lib/mlsClient.ts")
        .then(({ generateMlsKeyPackage }) => generateMlsKeyPackage())
        .then((keyPackage) => done({ keyPackage }))
        .catch((error) => done({ error: String(error) }));
    })
    .then((result) => {
      const value = result as { keyPackage?: NativeKeyPackageUpload; error?: string };
      assert.ok(value.keyPackage, `native KeyPackage generation failed: ${value.error ?? "unknown error"}`);
      return value.keyPackage;
    });
}

async function publishNativeKeyPackage(browser: Browser, deviceId: string, keyPackage: NativeKeyPackageUpload) {
  return browser.executeAsync(
    (targetDeviceId, upload, done) => {
      import("/src/lib/workspaceClient.ts")
        .then(({ publishKeyPackages }) => publishKeyPackages(targetDeviceId, [upload]))
        .then(() => done({ accepted: true }))
        .catch((error) => done({ accepted: false, error: String(error) }));
    },
    deviceId,
    keyPackage
  ) as Promise<{ accepted: boolean; error?: string }>;
}

export async function keyPackageCount(browser: Browser, relayBaseUrl: string, deviceId: string) {
  return browser.executeAsync(
    (baseUrl, targetDeviceId, done) => {
      fetch(`${baseUrl}/devices/${encodeURIComponent(targetDeviceId)}/key-packages/count`, {
        credentials: "include"
      })
        .then(async (response) => done({ status: response.status, body: await response.json() }))
        .catch((error) => done({ error: String(error) }));
    },
    relayBaseUrl,
    deviceId
  ) as Promise<{ status?: number; body?: { count?: number }; error?: string }>;
}

export async function assertTamperedKeyPackageRejected(
  guest: Browser,
  relayBaseUrl: string,
  teamId: string,
  guestUserId: string
) {
  let deviceId: string | undefined;
  await guest.waitUntil(
    async () => {
      const devices = await guest.executeAsync(
        (baseUrl, targetTeamId, done) => {
          fetch(`${baseUrl}/teams/${encodeURIComponent(targetTeamId)}/devices`, { credentials: "include" })
            .then(async (response) => done({ status: response.status, body: await response.json() }))
            .catch((error) => done({ error: String(error) }));
        },
        relayBaseUrl,
        teamId
      );
      const deviceResponse = devices as {
        status?: number;
        body?: { devices?: Array<{ userId: string; deviceId: string }> };
      };
      deviceId = deviceResponse.body?.devices?.find((device) => device.userId === guestUserId)?.deviceId;
      return deviceResponse.status === 200 && Boolean(deviceId);
    },
    { timeout: 30_000, timeoutMsg: "authenticated native guest device was not registered with the relay" }
  );
  assert.ok(deviceId, "authenticated native guest device was not registered with the relay");

  await guest.waitUntil(
    async () => {
      const count = await keyPackageCount(guest, relayBaseUrl, deviceId);
      return count.status === 200 && (count.body?.count ?? 0) >= 5;
    },
    {
      timeout: 30_000,
      timeoutMsg: "native guest did not finish its initial KeyPackage replenishment"
    }
  );
  const before = await keyPackageCount(guest, relayBaseUrl, deviceId);
  assert.equal(before.status, 200, `could not count native guest KeyPackages: ${before.error ?? ""}`);
  const valid = await generateNativeKeyPackage(guest);
  assert.deepEqual(
    await publishNativeKeyPackage(guest, deviceId, valid),
    { accepted: true },
    "real validator refused an untampered native KeyPackage control"
  );

  const tampered = await generateNativeKeyPackage(guest);
  const bytes = Buffer.from(tampered.keyPackage, "base64");
  assert.ok(bytes.length > 0, "native KeyPackage was unexpectedly empty");
  bytes[bytes.length - 1] ^= 1;
  tampered.keyPackage = bytes.toString("base64");
  tampered.keyPackageHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  // The relay has already checked the schema, canonical base64 and recomputed
  // hash before emitting this error. This response therefore proves that the
  // configured executable validator parsed and refused the mutated package.
  const rejection = await publishNativeKeyPackage(guest, deviceId, tampered);
  assert.equal(rejection.accepted, false, "real validator accepted a one-bit-tampered native KeyPackage");
  assert.match(
    rejection.error ?? "",
    /KeyPackage credential does not match its uploader/,
    `tampered KeyPackage did not reach the validator rejection boundary: ${rejection.error ?? "unknown error"}`
  );

  const after = await keyPackageCount(guest, relayBaseUrl, deviceId);
  assert.equal(after.status, 200, `could not recount native guest KeyPackages: ${after.error ?? ""}`);
  assert.equal(
    after.body?.count,
    (before.body?.count ?? 0) + 1,
    "rejected tampered KeyPackage changed durable relay state"
  );
  return deviceId;
}
