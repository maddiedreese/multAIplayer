import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceKeyAgreementIdentity, createInviteCapability } from "@multaiplayer/crypto";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });

const {
  consumePendingInviteCapability,
  loadPendingInviteCapability,
  pinInviteDeviceKey,
  loadPinnedInviteDeviceKey,
  rememberPendingInviteCapability,
  rememberIssuedInviteCapability,
  loadIssuedInviteCapability,
  verifyIssuedInviteCapability
} = await import("../src/lib/inviteCapabilityStore");

test("pending invite capability decisions are consumed exactly once", async () => {
  const host = await createDeviceKeyAgreementIdentity();
  const pending = {
    version: 3 as const,
    inviteId: "invite-1",
    teamId: "team-1",
    roomId: "room-1",
    roomName: "Room",
    inviteCapability: createInviteCapability(),
    keyEpoch: 1,
    hostUserId: "github:host",
    hostDeviceId: "device-host",
    hostPublicKeyJwk: host.publicKeyJwk,
    hostPublicKeyFingerprint: host.publicKeyFingerprint,
    requestId: "request-1",
    requestNonce: "abcdefghijklmnopqrstuv",
    requesterUserId: "github:peer",
    requesterDeviceId: "device-peer",
    requesterPublicKeyFingerprint: "sha256:" + "1111:".repeat(15) + "1111"
  };
  rememberPendingInviteCapability(pending);
  assert.equal(JSON.stringify(localStorage).includes(pending.inviteCapability), false);
  assert.deepEqual(loadPendingInviteCapability(pending.requestId), pending);
  assert.deepEqual(consumePendingInviteCapability(pending.requestId), pending);
  assert.equal(consumePendingInviteCapability(pending.requestId), null);
});

test("issued capabilities persist only a one-way verifier", async () => {
  const host = await createDeviceKeyAgreementIdentity();
  const capability = createInviteCapability();
  const invite = {
    version: 3 as const,
    teamId: "team-1",
    roomId: "room-1",
    roomName: "Room",
    inviteCapability: capability,
    keyEpoch: 1,
    hostUserId: "github:host",
    hostDeviceId: "device-host",
    hostPublicKeyJwk: host.publicKeyJwk,
    hostPublicKeyFingerprint: host.publicKeyFingerprint
  };
  await rememberIssuedInviteCapability("invite-1", invite);
  const serialized = localStorage.getItem("multaiplayer:issued-invite-capabilities:v4") ?? "";
  assert.equal(serialized.includes(capability), false);
  const issued = loadIssuedInviteCapability("invite-1");
  assert.ok(issued);
  assert.equal(await verifyIssuedInviteCapability(issued, capability), true);
  assert.equal(await verifyIssuedInviteCapability(issued, createInviteCapability()), false);
});

test("capability enrollment pins an exact device key", async () => {
  const first = await createDeviceKeyAgreementIdentity();
  const changed = await createDeviceKeyAgreementIdentity();
  assert.equal(
    pinInviteDeviceKey("room-1", "github:peer", "device-peer", first.publicKeyFingerprint, first.publicKeyJwk),
    true
  );
  assert.equal(
    pinInviteDeviceKey("room-1", "github:peer", "device-peer", first.publicKeyFingerprint, {
      y: first.publicKeyJwk.y,
      x: first.publicKeyJwk.x,
      crv: first.publicKeyJwk.crv,
      kty: first.publicKeyJwk.kty,
      ext: false
    }),
    true
  );
  assert.equal(
    pinInviteDeviceKey("room-1", "github:peer", "device-peer", first.publicKeyFingerprint, first.publicKeyJwk),
    true
  );
  assert.equal(
    pinInviteDeviceKey("room-1", "github:peer", "device-peer", changed.publicKeyFingerprint, changed.publicKeyJwk),
    false
  );
  assert.deepEqual(loadPinnedInviteDeviceKey("room-1", "github:peer", "device-peer"), {
    fingerprint: first.publicKeyFingerprint,
    jwk: first.publicKeyJwk
  });
});
