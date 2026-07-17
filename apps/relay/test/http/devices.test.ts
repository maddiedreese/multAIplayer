import { createECDH, createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { assert, createDebugSession, startRelayWithWorkspace } from "../support/relay.js";

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
