import { createECDH, createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { assert, createDebugSession, startRelayWithWorkspace, waitForStoredState } from "../support/relay.js";

test("device registration binds MLS signature and HPKE public keys", async () => {
  const relay = await startRelayWithWorkspace();
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const signaturePublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      hpkePublicKey = p256HpkePublicKey();
    const body = {
      deviceId: "device-reg-1",
      signaturePublicKey,
      signatureKeyFingerprint: fingerprint(signaturePublicKey),
      hpkePublicKey,
      hpkeKeyFingerprint: fingerprint(hpkePublicKey)
    };
    const first = await fetch(`${relay.baseUrl}/devices`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body)
    });
    assert.equal(first.status, 201);
    const listed = await fetch(`${relay.baseUrl}/devices`, { headers: { cookie } });
    assert.equal(listed.status, 200);
    assert.deepEqual(
      ((await listed.json()) as { devices: Array<{ deviceId: string }> }).devices.map((device) => device.deviceId),
      ["device-reg-1"]
    );
    const replacementHpkeKey = p256HpkePublicKey();
    const replacement = await fetch(`${relay.baseUrl}/devices`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        ...body,
        hpkePublicKey: replacementHpkeKey,
        hpkeKeyFingerprint: fingerprint(replacementHpkeKey)
      })
    });
    assert.equal(replacement.status, 409);
    assert.deepEqual(await replacement.json(), {
      error: "This device id is already bound to different public keys; register a new device id instead.",
      code: "conflict"
    });
    const signatureAlias = nonCanonicalAlias(signaturePublicKey);
    assert.equal(Buffer.from(signatureAlias, "base64").equals(Buffer.from(signaturePublicKey, "base64")), true);
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/devices`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ ...body, deviceId: "device-alias", signaturePublicKey: signatureAlias })
        })
      ).status,
      400
    );
    const wrongCurve = generateKeyPairSync("ec", { namedCurve: "secp384r1" })
      .publicKey.export({ format: "der", type: "spki" })
      .toString("base64");
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/devices`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            ...body,
            deviceId: "device-wrong-curve",
            signaturePublicKey: wrongCurve,
            signatureKeyFingerprint: fingerprint(wrongCurve)
          })
        })
      ).status,
      400
    );
  } finally {
    await relay.close();
  }
});

test("device registration enforces the retained per-account cap without blocking idempotent updates", async () => {
  const relay = await startRelayWithWorkspace({
    MULTAIPLAYER_RELAY_REGISTERED_DEVICE_CAP_USER: "1"
  });
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:device-cap", "device-cap");
    const firstBody = deviceRegistration("device-cap-1");
    const register = (body: ReturnType<typeof deviceRegistration>) =>
      fetch(`${relay.baseUrl}/devices`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body)
      });

    assert.equal((await register(firstBody)).status, 201);
    assert.equal(
      (await register(firstBody)).status,
      200,
      "the existing key binding must remain refreshable at the cap"
    );
    const rejected = await register(deviceRegistration("device-cap-2"));
    assert.equal(rejected.status, 429);
    assert.deepEqual(await rejected.json(), {
      error: "Registered device quota exceeded.",
      code: "quota_exceeded",
      quota: { type: "registered_devices_per_user", limit: 1, remaining: 0 }
    });
  } finally {
    await relay.close();
  }
});

test("device retirement permits an explicit key reset, reclaims the cap slot, and survives restart", async () => {
  const env = { MULTAIPLAYER_RELAY_REGISTERED_DEVICE_CAP_USER: "1" };
  const relay = await startRelayWithWorkspace(env);
  let restarted: Awaited<ReturnType<typeof startRelayWithWorkspace>> | null = null;
  let firstRelayClosed = false;
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:device-retirement", "device-retirement");
    const register = (baseUrl: string, body: ReturnType<typeof deviceRegistration>) =>
      fetch(`${baseUrl}/devices`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body)
      });

    assert.equal((await register(relay.baseUrl, deviceRegistration("retired-device"))).status, 201);
    const retired = await fetch(`${relay.baseUrl}/devices/retired-device`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmation: "retired-device" })
    });
    assert.equal(retired.status, 200);
    assert.deepEqual(await retired.json(), { retiredDeviceId: "retired-device" });
    assert.equal((await register(relay.baseUrl, deviceRegistration("retired-device"))).status, 201);
    await waitForStoredState(
      relay.dataPath,
      (state) =>
        state.devices?.some((device) => (device as { deviceId?: string }).deviceId === "retired-device") === true
    );

    await relay.close({ preserveData: true });
    firstRelayClosed = true;
    restarted = await startRelayWithWorkspace(env, undefined, relay.dataPath);
    assert.equal((await register(restarted.baseUrl, deviceRegistration("over-cap-device"))).status, 429);
  } finally {
    if (restarted) await restarted.close();
    else if (!firstRelayClosed) await relay.close();
  }
});

test("device retirement blocks retained room hosts", async () => {
  const relay = await startRelayWithWorkspace();
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const registered = await fetch(`${relay.baseUrl}/devices`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(deviceRegistration("host-device-1"))
    });
    assert.equal(registered.status, 201);
    const retired = await fetch(`${relay.baseUrl}/devices/host-device-1`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmation: "host-device-1" })
    });
    assert.equal(retired.status, 409);
  } finally {
    await relay.close();
  }
});

test("device retirement rejects a stale OAuth session without mutating the device", async () => {
  const relay = await startRelayWithWorkspace();
  try {
    const userId = "github:stale-retirement";
    const cookie = await createDebugSession(relay.baseUrl, userId, "stale-retirement");
    const body = deviceRegistration("stale-device");
    const register = (activeCookie: string) =>
      fetch(`${relay.baseUrl}/devices`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: activeCookie },
        body: JSON.stringify(body)
      });
    assert.equal((await register(cookie)).status, 201);
    assert.equal((await fetch(`${relay.baseUrl}/auth/logout`, { method: "POST", headers: { cookie } })).status, 200);
    const rejected = await fetch(`${relay.baseUrl}/devices/stale-device`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ confirmation: "stale-device" })
    });
    assert.equal(rejected.status, 401);

    const replacementCookie = await createDebugSession(relay.baseUrl, userId, "stale-retirement");
    assert.equal((await register(replacementCookie)).status, 200, "the rejected retirement must retain the binding");
  } finally {
    await relay.close();
  }
});

function deviceRegistration(deviceId: string) {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signaturePublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const hpkePublicKey = p256HpkePublicKey();
  return {
    deviceId,
    signaturePublicKey,
    signatureKeyFingerprint: fingerprint(signaturePublicKey),
    hpkePublicKey,
    hpkeKeyFingerprint: fingerprint(hpkePublicKey)
  };
}

function p256HpkePublicKey() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return ecdh.getPublicKey(undefined, "uncompressed").toString("base64");
}
function nonCanonicalAlias(encoded: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padLength = encoded.endsWith("==") ? 2 : 1;
  const index = encoded.length - padLength - 1;
  const value = alphabet.indexOf(encoded[index]!);
  return `${encoded.slice(0, index)}${alphabet[value + 1]}${encoded.slice(index + 1)}`;
}
function fingerprint(encoded: string) {
  const hex = createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex");
  return `sha256:${hex.match(/.{1,4}/g)!.join(":")}`;
}
