import { createECDH, createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { assert, createDebugSession, startRelayWithWorkspace } from "../support/relay.js";

test("device challenges are signed, single-use, and bound to the registered device", async () => {
  const relay = await startRelayWithWorkspace();
  try {
    const cookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const signaturePublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const hpke = createECDH("prime256v1");
    hpke.generateKeys();
    const hpkePublicKey = hpke.getPublicKey(undefined, "uncompressed").toString("base64");
    const register = await fetch(`${relay.baseUrl}/devices`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        deviceId: "device-auth-1",
        signaturePublicKey,
        signatureKeyFingerprint: fingerprint(signaturePublicKey),
        hpkePublicKey,
        hpkeKeyFingerprint: fingerprint(hpkePublicKey)
      })
    });
    assert.equal(register.status, 201);
    const challengeResponse = await fetch(`${relay.baseUrl}/devices/device-auth-1/challenge`, {
      method: "POST",
      headers: { cookie }
    });
    const { challenge } = (await challengeResponse.json()) as { challenge: string };
    const signature = sign(
      "sha256",
      authPayload("github:maddiedreese", "device-auth-1", Buffer.from(challenge, "base64")),
      privateKey
    ).toString("base64");
    const proof = {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ challenge, signature })
    } as const;
    const session = await fetch(`${relay.baseUrl}/devices/device-auth-1/session`, proof);
    assert.equal(session.status, 200);
    assert.ok(((await session.json()) as { deviceSessionToken: string }).deviceSessionToken.length >= 32);
    assert.equal(
      (await fetch(`${relay.baseUrl}/devices/device-auth-1/session`, proof)).status,
      403,
      "challenge replay must fail"
    );
  } finally {
    await relay.close();
  }
});

function fingerprint(encoded: string) {
  const hex = createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex");
  return `sha256:${hex.match(/.{1,4}/g)!.join(":")}`;
}
function authPayload(user: string, device: string, challenge: Buffer) {
  const u = Buffer.from(user),
    d = Buffer.from(device),
    ub = Buffer.alloc(2),
    db = Buffer.alloc(2);
  ub.writeUInt16BE(u.length);
  db.writeUInt16BE(d.length);
  return Buffer.concat([Buffer.from("multaiplayer:relay-device-auth:v1\0", "ascii"), ub, u, db, d, challenge]);
}
