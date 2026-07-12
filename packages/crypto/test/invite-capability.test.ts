import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeInviteCapabilityMac,
  createInviteCapability,
  parseInviteCapability,
  verifyInviteCapabilityMac,
  type InviteCapabilityRequestBinding,
  type InviteCapabilityResponseBinding
} from "../src/index";

const zeroCapability = Buffer.alloc(32).toString("base64url");
const fullCapability = Buffer.alloc(32, 0xff).toString("base64url");

const request: InviteCapabilityRequestBinding = {
  phase: "request",
  inviteId: "invite-1",
  teamId: "team-1",
  roomId: "room-1",
  keyEpoch: 7,
  requestId: "request-1",
  requestNonce: "abcdefghijklmnopqrstuv",
  requesterUserId: "github:requester",
  requesterDeviceId: "device-requester",
  requesterPublicKeyFingerprint: "sha256:requester",
  hostUserId: "github:host",
  hostDeviceId: "device-host",
  hostPublicKeyFingerprint: "sha256:host"
};

const response: InviteCapabilityResponseBinding = {
  ...request,
  phase: "response",
  status: "approved",
  decidedAt: "2026-07-11T12:00:00.000Z"
};

test("invite capability generation returns independent canonical 256-bit secrets", () => {
  const capabilities = Array.from({ length: 64 }, () => createInviteCapability());
  assert.equal(new Set(capabilities).size, capabilities.length);
  for (const capability of capabilities) {
    assert.match(capability, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(parseInviteCapability(capability).byteLength, 32);
  }
});

test("invite capability parser accepts exact canonical boundary vectors", () => {
  assert.deepEqual(parseInviteCapability(zeroCapability), new Uint8Array(32));
  assert.deepEqual(parseInviteCapability(fullCapability), new Uint8Array(32).fill(0xff));
});

test("invite capability parser rejects malformed, noncanonical, and wrong-length values", () => {
  const invalid = [
    "",
    "A",
    "A".repeat(42),
    "A".repeat(44),
    `${zeroCapability}=`,
    ` ${zeroCapability}`,
    `${zeroCapability} `,
    `${zeroCapability}\n`,
    `+${zeroCapability.slice(1)}`,
    `/${zeroCapability.slice(1)}`,
    `%${zeroCapability.slice(1)}`,
    `é${zeroCapability.slice(1)}`,
    `${"A".repeat(42)}B`
  ];
  for (const capability of invalid) {
    assert.throws(() => parseInviteCapability(capability), /Invite capability/);
  }
});

test("request MAC authenticates every request binding field", async () => {
  const mac = await computeInviteCapabilityMac(zeroCapability, request);
  const replacements: Record<keyof InviteCapabilityRequestBinding, unknown> = {
    phase: "response",
    inviteId: "invite-2",
    teamId: "team-2",
    roomId: "room-2",
    keyEpoch: 8,
    requestId: "request-2",
    requestNonce: "zyxwvutsrqponmlkjihgfe",
    requesterUserId: "github:other-requester",
    requesterDeviceId: "device-other-requester",
    requesterPublicKeyFingerprint: "sha256:other-requester",
    hostUserId: "github:other-host",
    hostDeviceId: "device-other-host",
    hostPublicKeyFingerprint: "sha256:other-host"
  };

  assert.equal(await verifyInviteCapabilityMac(zeroCapability, request, mac), true);
  for (const [field, replacement] of Object.entries(replacements)) {
    const changed = { ...request, [field]: replacement } as InviteCapabilityRequestBinding;
    assert.equal(await verifyInviteCapabilityMac(zeroCapability, changed, mac), false, field);
  }
});

test("response MAC authenticates every response binding field", async () => {
  const mac = await computeInviteCapabilityMac(zeroCapability, response);
  const replacements: Record<keyof InviteCapabilityResponseBinding, unknown> = {
    phase: "request",
    inviteId: "invite-2",
    teamId: "team-2",
    roomId: "room-2",
    keyEpoch: 8,
    requestId: "request-2",
    requestNonce: "zyxwvutsrqponmlkjihgfe",
    requesterUserId: "github:other-requester",
    requesterDeviceId: "device-other-requester",
    requesterPublicKeyFingerprint: "sha256:other-requester",
    hostUserId: "github:other-host",
    hostDeviceId: "device-other-host",
    hostPublicKeyFingerprint: "sha256:other-host",
    status: "denied",
    decidedAt: "2026-07-11T12:00:01.000Z"
  };

  assert.equal(await verifyInviteCapabilityMac(zeroCapability, response, mac), true);
  for (const [field, replacement] of Object.entries(replacements)) {
    const changed = { ...response, [field]: replacement } as InviteCapabilityResponseBinding;
    assert.equal(await verifyInviteCapabilityMac(zeroCapability, changed, mac), false, field);
  }
});

test("request and response MACs cannot be replayed across phases", async () => {
  const requestMac = await computeInviteCapabilityMac(zeroCapability, request);
  const responseMac = await computeInviteCapabilityMac(zeroCapability, response);
  assert.equal(await verifyInviteCapabilityMac(zeroCapability, response, requestMac), false);
  assert.equal(await verifyInviteCapabilityMac(zeroCapability, request, responseMac), false);
});

test("MAC verification fails closed for malformed capabilities and signatures", async () => {
  const mac = await computeInviteCapabilityMac(zeroCapability, request);
  const invalidCapabilities = ["", "A".repeat(42), `${zeroCapability}=`, `%${zeroCapability.slice(1)}`];
  const invalidMacs = [
    "",
    "A",
    "%",
    `${mac}=`,
    Buffer.alloc(31).toString("base64url"),
    Buffer.alloc(33).toString("base64url"),
    Buffer.alloc(32, 1).toString("base64url")
  ];

  for (const capability of invalidCapabilities) {
    assert.equal(await verifyInviteCapabilityMac(capability, request, mac), false);
  }
  for (const candidate of invalidMacs) {
    assert.equal(await verifyInviteCapabilityMac(zeroCapability, request, candidate), false);
  }
  for (const index of [0, 15, 31]) {
    const bytes = Buffer.from(mac, "base64url");
    bytes[index] ^= 1;
    assert.equal(await verifyInviteCapabilityMac(zeroCapability, request, bytes.toString("base64url")), false);
  }
  await assert.rejects(() => computeInviteCapabilityMac("invalid", request), /Invite capability/);
});

test("request MAC matches the published deterministic vector", async () => {
  assert.equal(
    await computeInviteCapabilityMac(zeroCapability, request),
    "thamyX76Bs3YPvFD_pTJbh2IDz2wiulj9iO0wnPvDtg"
  );
});
