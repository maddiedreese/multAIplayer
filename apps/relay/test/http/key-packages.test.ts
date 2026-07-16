import { createECDH, createHash, generateKeyPairSync, sign } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  WebSocket,
  assert,
  createDebugSession,
  onceOpen,
  startRelayWithWorkspace,
  waitForJoined,
  waitForPublished
} from "../support/relay.js";
import { commitValidatedKeyPackages } from "../../src/http/key-package-upload-transaction.js";
import { createRelayStore } from "../../src/state.js";
import type { KeyPackageRecord } from "@multaiplayer/protocol";

const validatorPath = fileURLToPath(new URL("../fixtures/mock-keypackage-validator.mjs", import.meta.url));
test("KeyPackage consume binds approval and Welcome is one-shot", async () => {
  const relay = await startRelayWithWorkspace({
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false",
    MULTAIPLAYER_MLS_VALIDATOR_PATH: validatorPath
  });
  try {
    const host = await device(relay.baseUrl, "github:maddiedreese", "host-device-1");
    const peer = await device(relay.baseUrl, "github:tester", "peer-device-1");
    const hostHeaders = { "content-type": "application/json", cookie: host.cookie, "x-device-session": host.token };
    const peerHeaders = { "content-type": "application/json", cookie: peer.cookie, "x-device-session": peer.token };
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/rooms/room-desktop/host`, {
          method: "PATCH",
          headers: hostHeaders,
          body: JSON.stringify({
            host: "Maddie",
            hostUserId: "github:maddiedreese",
            hostDeviceId: "host-device-1",
            hostStatus: "active"
          })
        })
      ).status,
      409,
      "an initialized room cannot reclaim host authority through the direct route"
    );
    const createRoomResponse = await fetch(`${relay.baseUrl}/rooms`, {
      method: "POST",
      headers: hostHeaders,
      body: JSON.stringify({ teamId: "team-core", name: "Bootstrap" })
    });
    assert.equal(createRoomResponse.status, 201);
    const bootstrapRoom = (
      (await createRoomResponse.json()) as {
        room: { id: string; host: string; hostUserId: string; hostStatus: string; acceptedMlsEpoch?: number };
      }
    ).room;
    assert.equal(bootstrapRoom.hostUserId, "github:maddiedreese");
    assert.equal(bootstrapRoom.hostStatus, "offline");
    assert.equal(bootstrapRoom.acceptedMlsEpoch, undefined);
    const bootstrapUrl = `${relay.baseUrl}/rooms/${bootstrapRoom.id}/host`;
    assert.equal(
      (
        await fetch(bootstrapUrl, {
          method: "PATCH",
          headers: peerHeaders,
          body: JSON.stringify({
            host: bootstrapRoom.host,
            hostUserId: "github:tester",
            hostDeviceId: "peer-device-1",
            hostStatus: "active"
          })
        })
      ).status,
      409,
      "a team member cannot steal an uninitialized room reserved to its creator"
    );
    assert.equal(
      (
        await fetch(bootstrapUrl, {
          method: "PATCH",
          headers: hostHeaders,
          body: JSON.stringify({
            host: bootstrapRoom.host,
            hostUserId: bootstrapRoom.hostUserId,
            hostDeviceId: "host-device-1",
            hostStatus: "active"
          })
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(bootstrapUrl, {
          method: "PATCH",
          headers: hostHeaders,
          body: JSON.stringify({
            host: bootstrapRoom.host,
            hostUserId: bootstrapRoom.hostUserId,
            hostStatus: "offline"
          })
        })
      ).status,
      409,
      "bootstrap is one-shot and active-to-offline transitions are forbidden"
    );
    const hostSocket = new WebSocket(relay.wsUrl, { headers: { cookie: host.cookie } });
    await onceOpen(hostSocket);
    const joined = waitForJoined(hostSocket);
    hostSocket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:maddiedreese",
        deviceId: "host-device-1",
        deviceSessionToken: host.token
      })
    );
    await joined;
    const notified = new Promise<Record<string, unknown>>((resolve) =>
      hostSocket.on("message", (raw) => {
        const value = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (value.type === "invite.requested") resolve(value);
      })
    );
    const inviteResponse = await fetch(`${relay.baseUrl}/invites`, {
      method: "POST",
      headers: hostHeaders,
      body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
    });
    const invite = ((await inviteResponse.json()) as { invite: { id: string; expiresAt: string } }).invite;
    const keyPackage = "AA==",
      keyPackageHash = `sha256:${createHash("sha256").update(Buffer.from(keyPackage, "base64")).digest("hex")}`;
    const upload = await fetch(`${relay.baseUrl}/devices/peer-device-1/key-packages`, {
      method: "POST",
      headers: peerHeaders,
      body: JSON.stringify({ keyPackages: [{ id: "kp-one", keyPackage, keyPackageHash, ciphersuite: 2 }] })
    });
    assert.equal(upload.status, 201);
    const mismatch = await fetch(`${relay.baseUrl}/devices/peer-device-1/key-packages`, {
      method: "POST",
      headers: peerHeaders,
      body: JSON.stringify({
        keyPackages: [{ id: "kp-bad", keyPackage, keyPackageHash: `sha256:${"0".repeat(64)}`, ciphersuite: 2 }]
      })
    });
    assert.equal(mismatch.status, 400);
    const wrongIdentityPackage = "AQ==";
    const wrongIdentityHash = `sha256:${createHash("sha256").update(Buffer.from(wrongIdentityPackage, "base64")).digest("hex")}`;
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/devices/peer-device-1/key-packages`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            keyPackages: [
              {
                id: "kp-wrong-identity",
                keyPackage: wrongIdentityPackage,
                keyPackageHash: wrongIdentityHash,
                ciphersuite: 2
              }
            ]
          })
        })
      ).status,
      400
    );
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/requests`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            requestId: "bad\nrequest",
            requesterDeviceId: "peer-device-1",
            keyPackageId: "kp-one",
            keyPackageHash,
            sealedRequest: directedSealedRequest({
              inviteId: invite.id,
              keyPackageHash,
              requestId: "bad-request",
              expiresAt: invite.expiresAt
            })
          })
        })
      ).status,
      400,
      "request identifiers are bounded and control-free before persistence or notification"
    );
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/requests`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            requestId: "request-one",
            requesterDeviceId: "peer-device-1",
            keyPackageId: "kp-one",
            keyPackageHash,
            sealedRequest: directedSealedRequest({
              inviteId: invite.id,
              keyPackageHash,
              requestId: "request-one",
              expiresAt: invite.expiresAt
            })
          })
        })
      ).status,
      201
    );
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/requests`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            requestId: "request-one",
            requesterDeviceId: "peer-device-1",
            keyPackageId: "kp-one",
            keyPackageHash,
            sealedRequest: directedSealedRequest({
              inviteId: invite.id,
              keyPackageHash,
              requestId: "request-one",
              expiresAt: invite.expiresAt
            })
          })
        })
      ).status,
      200,
      "an exact request retry does not create a second pending binding"
    );
    const notification = await notified;
    assert.deepEqual(notification, { type: "invite.requested", inviteId: invite.id, requestId: "request-one" });
    const pendingResponse = await fetch(`${relay.baseUrl}/invites/${invite.id}/requests?hostDeviceId=host-device-1`, {
      headers: hostHeaders
    });
    assert.equal(pendingResponse.status, 200);
    const pendingBody = (await pendingResponse.json()) as {
      requests: Array<{ requesterDevice: Record<string, unknown> | null }>;
    };
    assert.deepEqual(pendingBody.requests[0]?.requesterDevice, {
      userId: "github:tester",
      deviceId: "peer-device-1",
      signaturePublicKey: peer.signaturePublicKey,
      signatureKeyFingerprint: fingerprint(peer.signaturePublicKey)
    });
    assert.equal("hpkePublicKey" in pendingBody.requests[0]!.requesterDevice!, false);
    assert.equal("displayName" in pendingBody.requests[0]!.requesterDevice!, false);
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/requests?hostDeviceId=peer-device-1`, {
          headers: peerHeaders
        })
      ).status,
      403,
      "a requester cannot read the host-only identity projection"
    );
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/requests?hostDeviceId=host-device-1`, {
          headers: { cookie: host.cookie }
        })
      ).status,
      403,
      "the host account cannot read the projection without its device session"
    );
    assert.equal(JSON.stringify(notification).includes("sealedRequest"), false);
    const alternateKeyPackage = "BQ==";
    const alternateKeyPackageHash = `sha256:${createHash("sha256").update(Buffer.from(alternateKeyPackage, "base64")).digest("hex")}`;
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/devices/peer-device-1/key-packages`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            keyPackages: [
              {
                id: "kp-alternate",
                keyPackage: alternateKeyPackage,
                keyPackageHash: alternateKeyPackageHash,
                ciphersuite: 2
              }
            ]
          })
        })
      ).status,
      201
    );
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/requests`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            requestId: "request-alternate",
            requesterDeviceId: "peer-device-1",
            keyPackageId: "kp-alternate",
            keyPackageHash: alternateKeyPackageHash,
            sealedRequest: directedSealedRequest({
              inviteId: invite.id,
              keyPackageHash: alternateKeyPackageHash,
              requestId: "request-alternate",
              expiresAt: invite.expiresAt
            })
          })
        })
      ).status,
      409,
      "one invite cannot bind a second pending request or KeyPackage"
    );
    const mismatchedConsume = await fetch(
      `${relay.baseUrl}/rooms/room-desktop/key-packages/github%3Atester/peer-device-1/consume`,
      {
        method: "POST",
        headers: hostHeaders,
        body: JSON.stringify({
          hostDeviceId: "host-device-1",
          inviteId: invite.id,
          keyPackageId: "kp-one",
          keyPackageHash: `sha256:${"f".repeat(64)}`
        })
      }
    );
    assert.equal(mismatchedConsume.status, 409);
    const consume = await fetch(
      `${relay.baseUrl}/rooms/room-desktop/key-packages/github%3Atester/peer-device-1/consume`,
      {
        method: "POST",
        headers: hostHeaders,
        body: JSON.stringify({
          hostDeviceId: "host-device-1",
          inviteId: invite.id,
          keyPackageId: "kp-one",
          keyPackageHash
        })
      }
    );
    assert.equal(consume.status, 200);
    const consumeRetry = await fetch(
      `${relay.baseUrl}/rooms/room-desktop/key-packages/github%3Atester/peer-device-1/consume`,
      {
        method: "POST",
        headers: hostHeaders,
        body: JSON.stringify({
          hostDeviceId: "host-device-1",
          inviteId: invite.id,
          keyPackageId: "kp-one",
          keyPackageHash
        })
      }
    );
    assert.equal(consumeRetry.status, 200);
    assert.deepEqual(await consumeRetry.json(), {
      alreadyConsumed: true,
      keyPackageId: "kp-one",
      keyPackageHash,
      userId: "github:tester",
      deviceId: "peer-device-1"
    });
    const decidedAt = new Date().toISOString();
    const responseBinding = {
      version: 3,
      phase: "response",
      inviteId: invite.id,
      teamId: "team-core",
      roomId: "room-desktop",
      keyEpoch: 0,
      keyPackageHash,
      requestId: "request-one",
      requestNonce: "request-nonce-0001",
      requesterUserId: "github:tester",
      requesterDeviceId: "peer-device-1",
      hostUserId: "github:maddiedreese",
      hostDeviceId: "host-device-1",
      expiresAt: invite.expiresAt,
      status: "approved",
      decidedAt
    };
    const welcomeBody = {
      hostDeviceId: "host-device-1",
      requestId: "request-one",
      status: "approved",
      responseBinding,
      responseMac: "AA==",
      welcome: "AA=="
    };
    const prematureWelcome = await fetch(`${relay.baseUrl}/invites/${invite.id}/response`, {
      method: "POST",
      headers: hostHeaders,
      body: JSON.stringify(welcomeBody)
    });
    assert.equal(prematureWelcome.status, 409);
    assert.deepEqual(await prematureWelcome.json(), {
      error: "The membership Commit must be durably accepted before publishing its Welcome.",
      code: "conflict"
    });
    const commitId = "membership-commit-before-welcome";
    const publishedCommit = waitForPublished(hostSocket, commitId);
    hostSocket.send(
      JSON.stringify({
        type: "publish",
        message: {
          id: commitId,
          teamId: "team-core",
          roomId: "room-desktop",
          senderUserId: "github:maddiedreese",
          senderDeviceId: "host-device-1",
          createdAt: new Date().toISOString(),
          messageType: "commit",
          epochHint: 0,
          mlsMessage: "AA=="
        }
      })
    );
    await publishedCommit;
    hostSocket.close();
    const mismatchedRequestBinding = await fetch(`${relay.baseUrl}/invites/${invite.id}/response`, {
      method: "POST",
      headers: hostHeaders,
      body: JSON.stringify({
        ...welcomeBody,
        responseBinding: { ...responseBinding, requestNonce: "different-request-nonce" }
      })
    });
    assert.equal(mismatchedRequestBinding.status, 400);
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/response`, {
          method: "POST",
          headers: hostHeaders,
          body: JSON.stringify(welcomeBody)
        })
      ).status,
      201
    );
    const responseReplay = {
      hostDeviceId: "host-device-1",
      requestId: "request-one",
      status: "approved",
      responseBinding,
      responseMac: "AA==",
      welcome: "AA=="
    };
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/response`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify(responseReplay)
        })
      ).status,
      403,
      "idempotent response retries must authenticate the active host before revealing a match"
    );
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/response`, {
          method: "POST",
          headers: hostHeaders,
          body: JSON.stringify(responseReplay)
        })
      ).status,
      200
    );
    const secondKeyPackage = "Ag==";
    const secondKeyPackageHash = `sha256:${createHash("sha256").update(Buffer.from(secondKeyPackage, "base64")).digest("hex")}`;
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/devices/peer-device-1/key-packages`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            keyPackages: [
              { id: "kp-two", keyPackage: secondKeyPackage, keyPackageHash: secondKeyPackageHash, ciphersuite: 2 }
            ]
          })
        })
      ).status,
      201
    );
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/requests`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            requestId: "request-after-decision",
            requesterDeviceId: "peer-device-1",
            keyPackageId: "kp-two",
            keyPackageHash: secondKeyPackageHash,
            sealedRequest: directedSealedRequest({
              inviteId: invite.id,
              keyPackageHash: secondKeyPackageHash,
              requestId: "request-after-decision",
              expiresAt: invite.expiresAt
            })
          })
        })
      ).status,
      409,
      "a published invite decision blocks dead-link request races before ACK"
    );
    const deniedInvite = (
      (await (
        await fetch(`${relay.baseUrl}/invites`, {
          method: "POST",
          headers: hostHeaders,
          body: JSON.stringify({ teamId: "team-core", roomId: "room-desktop" })
        })
      ).json()) as { invite: { id: string; expiresAt: string } }
    ).invite;
    const deniedKeyPackage = "Aw==";
    const deniedKeyPackageHash = `sha256:${createHash("sha256").update(Buffer.from(deniedKeyPackage, "base64")).digest("hex")}`;
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/devices/peer-device-1/key-packages`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            keyPackages: [
              {
                id: "kp-denied",
                keyPackage: deniedKeyPackage,
                keyPackageHash: deniedKeyPackageHash,
                ciphersuite: 2
              }
            ]
          })
        })
      ).status,
      201
    );
    const sealedRequest = directedSealedRequest({
      inviteId: deniedInvite.id,
      keyPackageHash: deniedKeyPackageHash,
      requestId: "request-denied",
      expiresAt: deniedInvite.expiresAt,
      keyEpoch: 1
    });
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${deniedInvite.id}/requests`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            requestId: "request-denied",
            requesterDeviceId: "peer-device-1",
            keyPackageId: "kp-denied",
            keyPackageHash: deniedKeyPackageHash,
            sealedRequest
          })
        })
      ).status,
      201
    );
    const deniedAt = new Date().toISOString();
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${deniedInvite.id}/response`, {
          method: "POST",
          headers: hostHeaders,
          body: JSON.stringify({
            hostDeviceId: "host-device-1",
            requestId: "request-denied",
            status: "denied",
            responseBinding: {
              ...responseBinding,
              inviteId: deniedInvite.id,
              keyPackageHash: deniedKeyPackageHash,
              requestId: "request-denied",
              keyEpoch: 1,
              expiresAt: deniedInvite.expiresAt,
              status: "denied",
              decidedAt: deniedAt
            },
            responseMac: "AA=="
          })
        })
      ).status,
      201
    );
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${deniedInvite.id}/requests`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({
            requestId: "request-after-denial",
            requesterDeviceId: "peer-device-1",
            keyPackageId: "kp-two",
            keyPackageHash: secondKeyPackageHash,
            sealedRequest
          })
        })
      ).status,
      409,
      "a denial published before ACK prevents a new request from racing the deleted verifier"
    );
    const deniedAckUrl = `${relay.baseUrl}/invites/${deniedInvite.id}/response/request-denied/ack`;
    assert.equal(
      (
        await fetch(deniedAckUrl, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({ requesterDeviceId: "peer-device-1" })
        })
      ).status,
      204
    );
    assert.equal(
      (
        await fetch(deniedAckUrl, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({ requesterDeviceId: "peer-device-1" })
        })
      ).status,
      204,
      "denied ACK retries resolve from the durable receipt without membership"
    );
    const responseUrl = `${relay.baseUrl}/invites/${invite.id}/response/request-one?requesterDeviceId=peer-device-1`;
    assert.equal((await fetch(responseUrl, { headers: peerHeaders })).status, 200);
    assert.equal((await fetch(responseUrl, { headers: peerHeaders })).status, 200);
    assert.equal(
      (
        await fetch(`${relay.baseUrl}/invites/${invite.id}/response/request-one/ack`, {
          method: "POST",
          headers: peerHeaders,
          body: JSON.stringify({ requesterDeviceId: "peer-device-1" })
        })
      ).status,
      204
    );
    assert.equal((await fetch(responseUrl, { headers: peerHeaders })).status, 404);
    const admittedSocket = new WebSocket(relay.wsUrl, { headers: { cookie: peer.cookie } });
    await onceOpen(admittedSocket);
    const admitted = waitForJoined(admittedSocket);
    admittedSocket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: "github:tester",
        deviceId: "peer-device-1",
        deviceSessionToken: peer.token
      })
    );
    await admitted;
    admittedSocket.close();
    const oversize = await fetch(`${relay.baseUrl}/invites/${invite.id}/requests`, {
      method: "POST",
      headers: peerHeaders,
      body: JSON.stringify({
        requestId: "request-large",
        requesterDeviceId: "peer-device-1",
        keyPackageId: "missing",
        keyPackageHash,
        sealedRequest: "x".repeat(1_400_001)
      })
    });
    assert.equal(oversize.status, 404, "ACK removes the consumed invite before parsing later request payloads");
  } finally {
    await relay.close();
  }
});

test("live KeyPackage ceilings apply across every device on an account", async () => {
  const relay = await startRelayWithWorkspace({
    MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH: "false",
    MULTAIPLAYER_MLS_VALIDATOR_PATH: validatorPath,
    MULTAIPLAYER_RELAY_LIVE_KEY_PACKAGE_CAP_USER: "1"
  });
  try {
    const first = await device(relay.baseUrl, "github:tester", "quota-device-one");
    const second = await device(relay.baseUrl, "github:tester", "quota-device-two");
    const upload = (deviceId: string, auth: Awaited<ReturnType<typeof device>>, id: string, encoded: string) =>
      fetch(`${relay.baseUrl}/devices/${deviceId}/key-packages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: auth.cookie,
          "x-device-session": auth.token
        },
        body: JSON.stringify({
          keyPackages: [
            {
              id,
              keyPackage: encoded,
              keyPackageHash: `sha256:${createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex")}`,
              ciphersuite: 2
            }
          ]
        })
      });
    const responses = await Promise.all([
      upload("quota-device-one", first, "quota-kp-one", "AA=="),
      upload("quota-device-two", second, "quota-kp-two", "Ag==")
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 429]);
    const rejected = responses.find((response) => response.status === 429)!;
    assert.equal(rejected.status, 429);
    assert.equal(((await rejected.json()) as { quota: { type: string } }).quota.type, "live_key_packages_per_user");
  } finally {
    await relay.close();
  }
});

test("validated KeyPackage commits serialize the per-device ceiling after validation", async () => {
  const store = createRelayStore();
  for (let index = 0; index < 49; index += 1) store.setKeyPackage(packageRecord(`seed-${index}`, index));
  const firstSave = deferred<void>();
  const first = commitValidatedKeyPackages({
    store,
    userId: "github:tester",
    deviceId: "quota-device",
    accepted: [packageRecord("candidate-one", 50)],
    accountLimit: 250,
    deviceLimit: 50,
    persist: () => firstSave.promise
  });
  const second = commitValidatedKeyPackages({
    store,
    userId: "github:tester",
    deviceId: "quota-device",
    accepted: [packageRecord("candidate-two", 51)],
    accountLimit: 250,
    deviceLimit: 50,
    persist: async () => {}
  });
  await Promise.resolve();
  firstSave.resolve();
  assert.equal((await first).status, "accepted");
  assert.equal((await second).status, "device_quota");
  assert.equal(store.keyPackagesForDevice("github:tester", "quota-device").length, 50);
});

test("validated KeyPackage commits reject a concurrent same-id collision", async () => {
  const store = createRelayStore();
  const firstSave = deferred<void>();
  const firstRecord = packageRecord("shared-id", 1);
  const secondRecord = packageRecord("shared-id", 2);
  const first = commitValidatedKeyPackages({
    store,
    userId: "github:tester",
    deviceId: "quota-device",
    accepted: [firstRecord],
    accountLimit: 250,
    deviceLimit: 50,
    persist: () => firstSave.promise
  });
  const second = commitValidatedKeyPackages({
    store,
    userId: "github:tester",
    deviceId: "quota-device",
    accepted: [secondRecord],
    accountLimit: 250,
    deviceLimit: 50,
    persist: async () => {}
  });
  await Promise.resolve();
  firstSave.resolve();
  assert.equal((await first).status, "accepted");
  assert.equal((await second).status, "conflict");
  assert.equal(store.keyPackages.get("shared-id"), firstRecord);
});

test("failed KeyPackage persistence rolls back only its contribution before the next winner", async () => {
  const store = createRelayStore();
  const firstSave = deferred<void>();
  const failedRecord = packageRecord("retry-id", 1);
  const winningRecord = packageRecord("retry-id", 2);
  const first = commitValidatedKeyPackages({
    store,
    userId: "github:tester",
    deviceId: "quota-device",
    accepted: [failedRecord],
    accountLimit: 250,
    deviceLimit: 50,
    persist: () => firstSave.promise
  });
  const second = commitValidatedKeyPackages({
    store,
    userId: "github:tester",
    deviceId: "quota-device",
    accepted: [winningRecord],
    accountLimit: 250,
    deviceLimit: 50,
    persist: async () => {}
  });
  await Promise.resolve();
  firstSave.reject(new Error("deterministic persistence failure"));
  assert.equal((await first).status, "persistence_unavailable");
  assert.equal((await second).status, "accepted");
  assert.equal(store.keyPackages.get("retry-id"), winningRecord);
});

function packageRecord(id: string, value: number): KeyPackageRecord {
  const keyPackage = Buffer.from([value % 256]).toString("base64");
  return {
    id,
    keyPackage,
    keyPackageHash: `sha256:${createHash("sha256").update(Buffer.from(keyPackage, "base64")).digest("hex")}`,
    ciphersuite: 2,
    userId: "github:tester",
    deviceId: "quota-device",
    credentialIdentity: "fixture",
    createdAt: new Date().toISOString()
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function device(baseUrl: string, userId: string, deviceId: string) {
  const cookie = await createDebugSession(baseUrl, userId, userId.split(":").at(-1)!);
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signaturePublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const hpke = createECDH("prime256v1");
  hpke.generateKeys();
  const hpkePublicKey = hpke.getPublicKey(undefined, "uncompressed").toString("base64");
  const headers = { "content-type": "application/json", cookie };
  assert.equal(
    (
      await fetch(`${baseUrl}/devices`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          deviceId,
          signaturePublicKey,
          signatureKeyFingerprint: fingerprint(signaturePublicKey),
          hpkePublicKey,
          hpkeKeyFingerprint: fingerprint(hpkePublicKey)
        })
      })
    ).status,
    201
  );
  const challenge = (
    (await (await fetch(`${baseUrl}/devices/${deviceId}/challenge`, { method: "POST", headers })).json()) as {
      challenge: string;
    }
  ).challenge;
  const signature = sign(
    "sha256",
    authPayload(userId, deviceId, Buffer.from(challenge, "base64")),
    privateKey
  ).toString("base64");
  const session = await fetch(`${baseUrl}/devices/${deviceId}/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({ challenge, signature })
  });
  return {
    cookie,
    token: ((await session.json()) as { deviceSessionToken: string }).deviceSessionToken,
    privateKey,
    signaturePublicKey
  };
}
function fingerprint(encoded: string) {
  const hex = createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex");
  return `sha256:${hex.match(/.{1,4}/g)!.join(":")}`;
}
function authPayload(user: string, device: string, c: Buffer) {
  const u = Buffer.from(user),
    d = Buffer.from(device),
    ub = Buffer.alloc(2),
    db = Buffer.alloc(2);
  ub.writeUInt16BE(u.length);
  db.writeUInt16BE(d.length);
  return Buffer.concat([Buffer.from("multaiplayer:relay-device-auth:v1\0", "ascii"), ub, u, db, d, c]);
}

function directedSealedRequest(input: {
  inviteId: string;
  keyPackageHash: string;
  requestId: string;
  expiresAt: string;
  keyEpoch?: number;
}) {
  return JSON.stringify({
    version: 3,
    binding: {
      version: 3,
      phase: "request",
      inviteId: input.inviteId,
      teamId: "team-core",
      roomId: "room-desktop",
      keyEpoch: input.keyEpoch ?? 0,
      keyPackageHash: input.keyPackageHash,
      requestId: input.requestId,
      requestNonce: "request-nonce-0001",
      requesterUserId: "github:tester",
      requesterDeviceId: "peer-device-1",
      hostUserId: "github:maddiedreese",
      hostDeviceId: "host-device-1",
      expiresAt: input.expiresAt,
      status: null,
      decidedAt: null
    },
    sealedPayload: {
      version: 1,
      kem_id: 16,
      kdf_id: 1,
      aead_id: 1,
      encapsulated_key: Array(65).fill(1),
      ciphertext: Array(16).fill(2)
    }
  });
}
