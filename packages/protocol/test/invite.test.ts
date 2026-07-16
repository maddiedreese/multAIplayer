import assert from "node:assert/strict";
import test from "node:test";
import {
  InviteJoinRequestRecord,
  InviteRecord,
  InviteResponseRecord,
  KeyPackageUpload,
  RelayServerMessage,
  pinnedMlsCiphersuite
} from "../src/index.js";

test("invite creator attribution is optional for stored-state compatibility", () => {
  const legacy = {
    id: "invite",
    teamId: "team",
    roomId: "room",
    createdAt: "2026-07-01T00:00:00.000Z"
  };
  assert.equal(InviteRecord.safeParse(legacy).success, true);
  assert.equal(InviteRecord.parse({ ...legacy, creatorUserId: "github:creator" }).creatorUserId, "github:creator");
});

test("KeyPackages reject unpinned suites", () => {
  const value = {
    id: "kp",
    keyPackage: "AA==",
    keyPackageHash: `sha256:${"a".repeat(64)}`,
    ciphersuite: pinnedMlsCiphersuite
  };
  assert.equal(KeyPackageUpload.safeParse(value).success, true);
  assert.equal(KeyPackageUpload.safeParse({ ...value, ciphersuite: 1 }).success, false);
});
test("invite request binds a KeyPackage hash", () =>
  assert.equal(
    InviteJoinRequestRecord.safeParse({
      requestId: "request",
      inviteId: "invite",
      requesterUserId: "user",
      requesterDeviceId: "device-1",
      keyPackageId: "package",
      keyPackageHash: `sha256:${"b".repeat(64)}`,
      sealedRequest: "AA==",
      createdAt: new Date().toISOString()
    }).success,
    true
  ));

test("invite responses bind decisions and Welcome presence", () => {
  const base = {
    requestId: "request",
    inviteId: "invite",
    requesterUserId: "user",
    requesterDeviceId: "device-1",
    keyPackageHash: `sha256:${"b".repeat(64)}`,
    responseBinding: {
      version: 3,
      phase: "response",
      inviteId: "invite",
      teamId: "team",
      roomId: "room",
      keyEpoch: 1,
      keyPackageHash: `sha256:${"b".repeat(64)}`,
      requestId: "request",
      requestNonce: "nonce",
      requesterUserId: "user",
      requesterDeviceId: "device-1",
      hostUserId: "host",
      hostDeviceId: "host-device",
      expiresAt: new Date().toISOString(),
      decidedAt: new Date().toISOString()
    },
    responseMac: "AA==",
    createdAt: new Date().toISOString()
  };
  assert.equal(
    InviteResponseRecord.safeParse({
      ...base,
      status: "approved",
      responseBinding: { ...base.responseBinding, status: "approved" },
      welcome: "AA=="
    }).success,
    true
  );
  assert.equal(
    InviteResponseRecord.safeParse({
      ...base,
      status: "denied",
      responseBinding: { ...base.responseBinding, status: "denied" }
    }).success,
    true
  );
  assert.equal(
    InviteResponseRecord.safeParse({
      ...base,
      status: "denied",
      responseBinding: { ...base.responseBinding, status: "denied" },
      welcome: "AA=="
    }).success,
    false
  );
});

test("publish errors correlate to one pending MLS message", () => {
  assert.equal(
    RelayServerMessage.safeParse({ type: "error", message: "stale", code: "stale_epoch", messageId: "commit-1" })
      .success,
    true
  );
});

test("relay errors can identify the affected team and room", () => {
  assert.equal(
    RelayServerMessage.safeParse({
      type: "error",
      message: "membership removed",
      code: "membership_removed",
      teamId: "team-core",
      roomId: "room-core"
    }).success,
    true
  );
});
