import { createHash } from "node:crypto";
import { test } from "node:test";
import { assert, createDebugSession, startRelay } from "../support/relay.js";

const firstKey = { kty: "EC", crv: "P-256", x: "first-x", y: "first-y" } as const;
const secondKey = { kty: "EC", crv: "P-256", x: "second-x", y: "second-y" } as const;

test("device registration authenticates ownership, verifies fingerprints, and fails closed on key replacement", async () => {
  const relay = await startRelay();
  try {
    const ownerCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");

    const unauthenticated = await register(relay.baseUrl, "", "github:maddiedreese", "device-owner", firstKey);
    assert.equal(unauthenticated.status, 401);

    const wrongUser = await register(relay.baseUrl, ownerCookie, "github:design", "device-owner", firstKey);
    assert.equal(wrongUser.status, 403);

    const mismatch = await register(
      relay.baseUrl,
      ownerCookie,
      "github:maddiedreese",
      "device-owner",
      firstKey,
      fingerprint(secondKey)
    );
    assert.equal(mismatch.status, 400);

    const created = await register(relay.baseUrl, ownerCookie, "github:maddiedreese", "device-owner", firstKey);
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { device: { publicKeyFingerprint: string } };
    assert.equal(createdBody.device.publicKeyFingerprint, fingerprint(firstKey));

    const refreshed = await register(relay.baseUrl, ownerCookie, "github:maddiedreese", "device-owner", firstKey);
    assert.equal(refreshed.status, 200);

    const replacement = await register(relay.baseUrl, ownerCookie, "github:maddiedreese", "device-owner", secondKey);
    assert.equal(replacement.status, 409);
  } finally {
    await relay.close();
  }
});

test("team device directory is membership scoped and excludes removed members", async () => {
  const relay = await startRelay();
  try {
    const ownerCookie = await createDebugSession(relay.baseUrl, "github:maddiedreese", "maddiedreese");
    const memberCookie = await createDebugSession(relay.baseUrl, "github:design", "design");
    const outsiderCookie = await createDebugSession(relay.baseUrl, "github:outsider", "outsider");

    assert.equal(
      (await register(relay.baseUrl, ownerCookie, "github:maddiedreese", "device-owner", firstKey)).status,
      201
    );
    assert.equal(
      (await register(relay.baseUrl, memberCookie, "github:design", "device-member", secondKey)).status,
      201
    );

    assert.equal((await fetch(`${relay.baseUrl}/teams/team-core/devices`)).status, 401);
    assert.equal(
      (await fetch(`${relay.baseUrl}/teams/team-core/devices`, { headers: { cookie: outsiderCookie } })).status,
      403
    );

    const visible = await fetch(`${relay.baseUrl}/teams/team-core/devices`, { headers: { cookie: memberCookie } });
    assert.equal(visible.status, 200);
    const visibleBody = (await visible.json()) as { devices: Array<{ userId: string; deviceId: string }> };
    assert.deepEqual(
      visibleBody.devices.map(({ userId, deviceId }) => [userId, deviceId]),
      [
        ["github:design", "device-member"],
        ["github:maddiedreese", "device-owner"]
      ]
    );

    const removed = await fetch(`${relay.baseUrl}/teams/team-core/members/github%3Adesign`, {
      method: "DELETE",
      headers: { cookie: ownerCookie }
    });
    assert.equal(removed.status, 200);
    assert.equal(
      (await fetch(`${relay.baseUrl}/teams/team-core/devices`, { headers: { cookie: memberCookie } })).status,
      403
    );

    const afterRemoval = await fetch(`${relay.baseUrl}/teams/team-core/devices`, { headers: { cookie: ownerCookie } });
    const afterRemovalBody = (await afterRemoval.json()) as { devices: Array<{ userId: string }> };
    assert.deepEqual(
      afterRemovalBody.devices.map((device) => device.userId),
      ["github:maddiedreese"]
    );
  } finally {
    await relay.close();
  }
});

function fingerprint(key: typeof firstKey | typeof secondKey): string {
  const canonical = `{"crv":"${key.crv}","kty":"${key.kty}","x":"${key.x}","y":"${key.y}"}`;
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hex.match(/.{1,4}/g)?.join(":") ?? hex}`;
}

function register(
  baseUrl: string,
  cookie: string,
  userId: string,
  deviceId: string,
  publicKeyJwk: typeof firstKey | typeof secondKey,
  publicKeyFingerprint = fingerprint(publicKeyJwk)
) {
  return fetch(`${baseUrl}/devices`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ userId, deviceId, displayName: userId, publicKeyJwk, publicKeyFingerprint })
  });
}
