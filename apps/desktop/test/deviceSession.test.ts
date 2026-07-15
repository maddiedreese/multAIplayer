import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { RelayHttpError } from "../src/lib/core/httpResponse";

let challengeRequests = 0;
let sessionRequests = 0;
let deferredSessionResponse: Promise<Response> | null = null;

Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
  configurable: true,
  value: {
    invoke: async (command: string) => {
      if (command === "mls_device_auth_sign") return { signatureDer: "c2lnbmF0dXJl", publicKeySpkiDer: "a2V5" };
      throw new Error(`Unexpected native command: ${command}`);
    }
  }
});

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/challenge")) {
      challengeRequests += 1;
      return Response.json({ challenge: "Y2hhbGxlbmdl", expiresAt: "2026-07-14T12:00:00.000Z" });
    }
    if (url.endsWith("/session")) {
      sessionRequests += 1;
      if (url.startsWith("http://old-relay") && deferredSessionResponse) return deferredSessionResponse;
      return Response.json({
        deviceSessionToken: url.startsWith("http://new-relay") ? "new-token" : "renewed-token",
        expiresAt: "2026-07-14T12:15:00.000Z"
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }
});

const {
  deviceSessionHeaders,
  establishDeviceSession,
  recoverDeviceSessionForRelayError,
  retryAfterDeviceSessionExpiry
} = await import("../src/lib/identity/deviceSession");

beforeEach(() => {
  challengeRequests = 0;
  sessionRequests = 0;
  deferredSessionResponse = null;
});

test("renews and retries once after the relay loses an ephemeral device session", async () => {
  let attempts = 0;
  let replacedToken: string | null = null;
  const result = await retryAfterDeviceSessionExpiry(
    "http://relay",
    "device-a",
    async () => {
      attempts += 1;
      if (attempts === 1) throw new RelayHttpError("renew device proof", 403, "device_auth_required");
      return "persisted Welcome";
    },
    (session) => {
      replacedToken = session.token;
    }
  );

  assert.equal(result, "persisted Welcome");
  assert.equal(attempts, 2);
  assert.equal(replacedToken, "renewed-token");
  assert.equal(challengeRequests, 1);
  assert.equal(sessionRequests, 1);
});

test("coalesces concurrent reconnect recovery onto one signed device challenge", async () => {
  const attempts = [0, 0];
  const run = (index: number) =>
    retryAfterDeviceSessionExpiry(
      "http://relay",
      "device-a",
      async () => {
        attempts[index] += 1;
        if (attempts[index] === 1) throw new RelayHttpError("renew device proof", 403, "device_auth_required");
        return index;
      },
      () => undefined
    );

  assert.deepEqual(await Promise.all([run(0), run(1)]), [0, 1]);
  assert.deepEqual(attempts, [2, 2]);
  assert.equal(challengeRequests, 1);
  assert.equal(sessionRequests, 1);
});

test("does not retry unrelated relay failures", async () => {
  let attempts = 0;
  await assert.rejects(
    retryAfterDeviceSessionExpiry(
      "http://relay",
      "device-a",
      async () => {
        attempts += 1;
        throw new RelayHttpError("forbidden", 403, "forbidden");
      },
      () => undefined
    ),
    /forbidden/
  );
  assert.equal(attempts, 1);
  assert.equal(challengeRequests, 0);
  assert.equal(sessionRequests, 0);
});

test("coordinates relay not_joined errors into a replacement session for the subscription hook", async () => {
  let replacedToken: string | null = null;
  assert.equal(
    await recoverDeviceSessionForRelayError(
      { code: "not_joined" },
      "http://relay",
      "device-a",
      "renewed-token",
      (session) => {
        replacedToken = session.token;
      }
    ),
    true
  );
  assert.equal(replacedToken, "renewed-token");
  assert.equal(challengeRequests, 1);
  assert.equal(sessionRequests, 1);
});

test("leaves ordinary relay errors to the existing error handler", async () => {
  assert.equal(
    await recoverDeviceSessionForRelayError({ code: "stale_epoch" }, "http://relay", "device-a", "renewed-token", () =>
      assert.fail("ordinary relay error unexpectedly renewed the device session")
    ),
    false
  );
  assert.equal(challengeRequests, 0);
  assert.equal(sessionRequests, 0);
});

test("an older in-flight establishment cannot overwrite a newer relay and device scope", async () => {
  let releaseOlderSession!: (response: Response) => void;
  deferredSessionResponse = new Promise<Response>((resolve) => {
    releaseOlderSession = resolve;
  });

  const older = establishDeviceSession("http://old-relay", "old-device");
  const newer = establishDeviceSession("http://new-relay", "new-device");

  assert.equal((await newer).token, "new-token");
  releaseOlderSession(Response.json({ deviceSessionToken: "old-token", expiresAt: "2026-07-14T12:15:00.000Z" }));
  await assert.rejects(older, /superseded by a newer identity or relay scope/);
  assert.deepEqual(deviceSessionHeaders(), { "x-device-session": "new-token" });
});
