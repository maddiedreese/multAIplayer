import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  WebSocket,
  createDebugSession,
  onceOpen,
  startRelayWithWorkspace,
  waitForJoined,
  type StoredRelayStateFixture
} from "./support/relay.js";

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const validatorPath = fileURLToPath(
  new URL("../../desktop/src-tauri/target/debug/mls-keypackage-validator", import.meta.url)
);
const marker = "MLS-PLAINTEXT-MUST-NEVER-REACH-RELAY";

interface NativeFixture {
  host: DeviceFixture;
  nextHost: DeviceFixture;
  keyPackageId: string;
  keyPackageHash: string;
  keyPackage: string;
  addCommitId: string;
  addCommit: string;
  welcome: string;
  applicationId: string;
  applicationEpoch: number;
  application: string;
  sealedBlob: { version: 1; epoch: number; nonce: string; ciphertext: string };
  sealedRequest: string;
  handoffCommitId: string;
  handoffCommit: string;
  handoffParentEpoch: number;
  hostTransferAuthorization: Record<string, unknown>;
  hostTransferSignature: string;
  hostTransferPublicKey: string;
  removalCommitId: string;
  removalCommit: string;
  removalParentEpoch: number;
  postRemovalApplicationId: string;
  postRemovalApplicationEpoch: number;
  postRemovalApplication: string;
  forbiddenValues: string[];
}
interface DeviceFixture {
  userId: string;
  deviceId: string;
  signaturePublicKey: string;
  signatureKeyFingerprint: string;
  hpkePublicKey: string;
  hpkeKeyFingerprint: string;
}

async function nativeFixture(): Promise<{ fixture: NativeFixture; stdout: string; stderr: string }> {
  await execFileAsync(
    "cargo",
    [
      "build",
      "--quiet",
      "--locked",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "-p",
      "mls-core",
      "--bin",
      "mls-keypackage-validator"
    ],
    { cwd: workspaceRoot, timeout: 120_000, maxBuffer: 2_000_000 }
  );
  const result = await execFileAsync(
    "cargo",
    [
      "run",
      "--quiet",
      "--locked",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "-p",
      "mls-core",
      "--features",
      "test-fixtures",
      "--bin",
      "mls-lifecycle-fixture"
    ],
    { cwd: workspaceRoot, timeout: 120_000, maxBuffer: 2_000_000 }
  );
  return { fixture: JSON.parse(result.stdout) as NativeFixture, stdout: result.stdout, stderr: result.stderr };
}

async function authenticatedDevice(
  baseUrl: string,
  device: DeviceFixture,
  secret: Buffer
): Promise<Record<string, string>> {
  const cookie = await createDebugSession(baseUrl, device.userId, device.userId.split(":").at(-1) ?? device.userId);
  const challengeResponse = await fetch(`${baseUrl}/devices/${device.deviceId}/challenge`, {
    method: "POST",
    headers: { cookie }
  });
  assert.equal(challengeResponse.status, 200);
  const { challenge } = (await challengeResponse.json()) as { challenge: string };
  const point = Buffer.from(device.signaturePublicKey, "base64").subarray(-65);
  const privateKey = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33, 65).toString("base64url"),
      d: secret.toString("base64url")
    },
    format: "jwk"
  });
  const signature = sign(
    "sha256",
    deviceAuthPayload(device.userId, device.deviceId, Buffer.from(challenge, "base64")),
    privateKey
  ).toString("base64");
  const sessionResponse = await fetch(`${baseUrl}/devices/${device.deviceId}/session`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ challenge, signature })
  });
  assert.equal(sessionResponse.status, 200);
  const { deviceSessionToken } = (await sessionResponse.json()) as { deviceSessionToken: string };
  return { "content-type": "application/json", cookie, "x-device-session": deviceSessionToken };
}

function deviceAuthPayload(user: string, device: string, challenge: Buffer): Buffer {
  const userBytes = Buffer.from(user),
    deviceBytes = Buffer.from(device),
    userLength = Buffer.alloc(2),
    deviceLength = Buffer.alloc(2);
  userLength.writeUInt16BE(userBytes.length);
  deviceLength.writeUInt16BE(deviceBytes.length);
  return Buffer.concat([
    Buffer.from("multaiplayer:relay-device-auth:v1\0", "ascii"),
    userLength,
    userBytes,
    deviceLength,
    deviceBytes,
    challenge
  ]);
}

function workspace(fixture: NativeFixture): StoredRelayStateFixture {
  const createdAt = "2026-07-12T12:00:00.000Z";
  const inviteExpiresAt = "2099-07-13T12:00:00.000Z";
  const requestBinding = {
    version: 3,
    phase: "request",
    inviteId: "invite-fixture",
    teamId: "team-core",
    roomId: "room-desktop",
    keyEpoch: 0,
    keyPackageHash: fixture.keyPackageHash,
    requestId: "request-fixture",
    requestNonce: "fixture-nonce-0001",
    requesterUserId: fixture.nextHost.userId,
    requesterDeviceId: fixture.nextHost.deviceId,
    hostUserId: fixture.host.userId,
    hostDeviceId: fixture.host.deviceId,
    expiresAt: inviteExpiresAt,
    status: null,
    decidedAt: null
  };
  return {
    version: 1,
    savedAt: createdAt,
    teams: [{ id: "team-core", name: "Core Team", members: 2 }],
    rooms: [
      {
        id: "room-desktop",
        teamId: "team-core",
        name: "Desktop app",
        projectPath: "/tmp/multaiplayer",
        host: "Maddie",
        hostUserId: fixture.host.userId,
        activeHostDeviceId: fixture.host.deviceId,
        hostStatus: "active",
        unread: 0,
        acceptedMlsEpoch: 0
      }
    ],
    invites: [
      {
        id: "invite-fixture",
        teamId: "team-core",
        roomId: "room-desktop",
        createdAt,
        expiresAt: inviteExpiresAt
      }
    ],
    teamMembers: [
      {
        teamId: "team-core",
        members: [
          { userId: fixture.host.userId, role: "owner", joinedAt: createdAt },
          { userId: fixture.nextHost.userId, role: "admin", joinedAt: createdAt }
        ]
      }
    ],
    devices: [fixture.host, fixture.nextHost].map((device) => ({
      ...device,
      displayName: device.deviceId,
      registeredAt: createdAt,
      lastSeenAt: createdAt
    })),
    inviteRequests: [
      {
        requestId: "request-fixture",
        inviteId: "invite-fixture",
        requesterUserId: fixture.nextHost.userId,
        requesterDeviceId: fixture.nextHost.deviceId,
        keyPackageId: fixture.keyPackageId,
        keyPackageHash: fixture.keyPackageHash,
        sealedRequest: JSON.stringify({
          version: 3,
          binding: requestBinding,
          sealedPayload: JSON.parse(fixture.sealedRequest) as unknown
        }),
        createdAt
      }
    ],
    inviteResponses: [
      {
        requestId: "request-fixture",
        inviteId: "invite-fixture",
        requesterUserId: fixture.nextHost.userId,
        requesterDeviceId: fixture.nextHost.deviceId,
        keyPackageHash: fixture.keyPackageHash,
        status: "approved",
        responseBinding: {
          version: 3,
          phase: "response",
          inviteId: "invite-fixture",
          teamId: "team-core",
          roomId: "room-desktop",
          keyEpoch: 0,
          keyPackageHash: fixture.keyPackageHash,
          requestId: "request-fixture",
          requestNonce: "fixture-nonce-0001",
          requesterUserId: fixture.nextHost.userId,
          requesterDeviceId: fixture.nextHost.deviceId,
          hostUserId: fixture.host.userId,
          hostDeviceId: fixture.host.deviceId,
          expiresAt: inviteExpiresAt,
          status: "approved",
          decidedAt: createdAt
        },
        responseMac: "AA==",
        welcome: fixture.welcome,
        createdAt
      }
    ],
    attachmentBlobs: [
      {
        id: "blob-fixture",
        teamId: "team-core",
        roomId: "room-desktop",
        name: "fixture.bin",
        type: "application/octet-stream",
        size: marker.length,
        epoch: fixture.sealedBlob.epoch,
        sealedBlob: JSON.stringify(fixture.sealedBlob),
        createdAt
      }
    ],
    mlsBacklog: [],
    encryptedBacklog: []
  };
}

function waitForPublished(socket: WebSocket, messageId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${messageId}`)), 5_000);
    const listener = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as { type: string; messageId?: string; message?: string };
      if (message.type === "error") {
        clearTimeout(timer);
        socket.off("message", listener);
        reject(new Error(message.message ?? "relay rejected message"));
      } else if (message.type === "published" && message.messageId === messageId) {
        clearTimeout(timer);
        socket.off("message", listener);
        resolve();
      }
    };
    socket.on("message", listener);
  });
}

async function scanRelay(relay: { dataPath: string }, wire: string[], forbidden: Buffer[]): Promise<void> {
  const binaryMarkers = [Buffer.from(marker), Buffer.from("MLS-REMOVED-MEMBER-MUST-NOT-DECRYPT"), ...forbidden];
  const needles = [...binaryMarkers, ...binaryMarkers.map((value) => Buffer.from(value.toString("base64")))];
  for (const path of [relay.dataPath, `${relay.dataPath}-wal`, `${relay.dataPath}-shm`]) {
    const bytes = await readFile(path).catch(() => Buffer.alloc(0));
    for (const needle of needles) assert.equal(bytes.includes(needle), false, `secret marker leaked into ${path}`);
  }
  const wireBytes = Buffer.from(wire.join("\n"));
  for (const needle of needles) assert.equal(wireBytes.includes(needle), false, "secret marker leaked onto relay wire");
}

test("native MLS, HPKE, Welcome, and exporter ciphertexts never persist relay plaintext", async () => {
  const generated = await nativeFixture();
  assert.equal(generated.stdout.includes(marker), false);
  assert.equal(generated.stderr.includes(marker), false);
  const fixture = generated.fixture;
  const forbidden = fixture.forbiddenValues.map((value) => Buffer.from(value, "base64"));
  assert.ok(forbidden.every((value) => value.length > 0));
  const relay = await startRelayWithWorkspace(
    { MULTAIPLAYER_RELAY_STORAGE: "sqlite", MULTAIPLAYER_MLS_VALIDATOR_PATH: validatorPath },
    workspace(fixture)
  );
  const hostSocket = new WebSocket(relay.wsUrl);
  const nextSocket = new WebSocket(relay.wsUrl);
  const hostOpened = onceOpen(hostSocket);
  const nextOpened = onceOpen(nextSocket);
  const wire: string[] = [];
  hostSocket.on("message", (x) => wire.push(x.toString()));
  nextSocket.on("message", (x) => wire.push(x.toString()));
  const publish = async (socket: WebSocket, message: Record<string, unknown>) => {
    const id = String(message.id);
    const acknowledged = waitForPublished(socket, id);
    socket.send(JSON.stringify({ type: "publish", message }));
    await acknowledged;
    await scanRelay(relay, wire, forbidden);
  };
  try {
    const hostHeaders = await authenticatedDevice(relay.baseUrl, fixture.host, forbidden[0]!);
    const nextHeaders = await authenticatedDevice(relay.baseUrl, fixture.nextHost, forbidden[1]!);
    const upload = await fetch(`${relay.baseUrl}/devices/${fixture.nextHost.deviceId}/key-packages`, {
      method: "POST",
      headers: nextHeaders,
      body: JSON.stringify({
        keyPackages: [
          {
            id: fixture.keyPackageId,
            keyPackage: fixture.keyPackage,
            keyPackageHash: fixture.keyPackageHash,
            ciphersuite: 2
          }
        ]
      })
    });
    assert.equal(upload.status, 201);
    const consume = await fetch(
      `${relay.baseUrl}/rooms/room-desktop/key-packages/${encodeURIComponent(fixture.nextHost.userId)}/${encodeURIComponent(fixture.nextHost.deviceId)}/consume`,
      {
        method: "POST",
        headers: hostHeaders,
        body: JSON.stringify({
          hostDeviceId: fixture.host.deviceId,
          inviteId: "invite-fixture",
          keyPackageId: fixture.keyPackageId,
          keyPackageHash: fixture.keyPackageHash
        })
      }
    );
    assert.equal(consume.status, 200);
    await scanRelay(relay, wire, forbidden);
    await hostOpened;
    const hostJoined = waitForJoined(hostSocket);
    hostSocket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: fixture.host.userId,
        deviceId: fixture.host.deviceId
      })
    );
    await hostJoined;
    await publish(hostSocket, {
      id: fixture.addCommitId,
      teamId: "team-core",
      roomId: "room-desktop",
      senderUserId: fixture.host.userId,
      senderDeviceId: fixture.host.deviceId,
      createdAt: new Date().toISOString(),
      messageType: "commit",
      epochHint: 0,
      mlsMessage: fixture.addCommit
    });
    await publish(hostSocket, {
      id: fixture.applicationId,
      teamId: "team-core",
      roomId: "room-desktop",
      senderUserId: fixture.host.userId,
      senderDeviceId: fixture.host.deviceId,
      createdAt: new Date().toISOString(),
      messageType: "application",
      epochHint: fixture.applicationEpoch,
      mlsMessage: fixture.application
    });
    await publish(hostSocket, {
      id: fixture.handoffCommitId,
      teamId: "team-core",
      roomId: "room-desktop",
      senderUserId: fixture.host.userId,
      senderDeviceId: fixture.host.deviceId,
      createdAt: new Date().toISOString(),
      messageType: "commit",
      epochHint: fixture.handoffParentEpoch,
      mlsMessage: fixture.handoffCommit,
      commitEffect: "host_handoff",
      nextHostUserId: fixture.nextHost.userId,
      nextHostDeviceId: fixture.nextHost.deviceId,
      hostTransferAuthorization: {
        ...fixture.hostTransferAuthorization,
        signatureDer: fixture.hostTransferSignature,
        publicKeySpkiDer: fixture.hostTransferPublicKey
      }
    });

    await nextOpened;
    const nextJoined = waitForJoined(nextSocket);
    nextSocket.send(
      JSON.stringify({
        type: "join",
        teamId: "team-core",
        roomId: "room-desktop",
        userId: fixture.nextHost.userId,
        deviceId: fixture.nextHost.deviceId
      })
    );
    await nextJoined;
    await publish(nextSocket, {
      id: fixture.removalCommitId,
      teamId: "team-core",
      roomId: "room-desktop",
      senderUserId: fixture.nextHost.userId,
      senderDeviceId: fixture.nextHost.deviceId,
      createdAt: new Date().toISOString(),
      messageType: "commit",
      epochHint: fixture.removalParentEpoch,
      mlsMessage: fixture.removalCommit
    });
    await publish(nextSocket, {
      id: fixture.postRemovalApplicationId,
      teamId: "team-core",
      roomId: "room-desktop",
      senderUserId: fixture.nextHost.userId,
      senderDeviceId: fixture.nextHost.deviceId,
      createdAt: new Date().toISOString(),
      messageType: "application",
      epochHint: fixture.postRemovalApplicationEpoch,
      mlsMessage: fixture.postRemovalApplication
    });
    await scanRelay(relay, wire, forbidden);
  } finally {
    hostSocket.close();
    nextSocket.close();
    await relay.close();
  }
});
