import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface, type Interface } from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { probeRustToolchain } from "./support/rust-toolchain.js";
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
const targetRoot = fileURLToPath(new URL("../../desktop/src-tauri/target/debug", import.meta.url));
const nativeClientPath = `${targetRoot}/mls-integration-client`;
const validatorPath = `${targetRoot}/mls-keypackage-validator`;
const rustToolchain = probeRustToolchain(process.env.MULTAIPLAYER_CARGO_BIN ?? "cargo");
const nativeOperationTimeoutMs = 15_000;

interface DeviceIdentity {
  userId: string;
  deviceId: string;
  signaturePublicKey: string;
  signatureKeyFingerprint: string;
  hpkePublicKey: string;
  hpkeKeyFingerprint: string;
}

interface NativeResponse {
  ok: boolean;
  value?: unknown;
  error?: string;
}

class NativeClient {
  readonly identity: DeviceIdentity;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #lines: Interface;
  readonly #responses: Array<(response: NativeResponse) => void> = [];
  #errorOutput = "";

  private constructor(child: ChildProcessWithoutNullStreams, lines: Interface, identity: DeviceIdentity) {
    this.#child = child;
    this.#lines = lines;
    this.identity = identity;
    child.stderr.on("data", (chunk) => (this.#errorOutput += chunk.toString()));
    lines.on("line", (line) => this.#responses.shift()?.(JSON.parse(line) as NativeResponse));
  }

  static async start(userId: string, deviceId: string): Promise<NativeClient> {
    const child = spawn(nativeClientPath, [userId, deviceId], { stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: child.stdout });
    const identity = await new Promise<DeviceIdentity>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Native MLS client did not initialize")),
        nativeOperationTimeoutMs
      );
      lines.once("line", (line) => {
        clearTimeout(timer);
        const response = JSON.parse(line) as NativeResponse & DeviceIdentity;
        if (!response.ok) reject(new Error(response.error ?? "Native MLS client initialization failed"));
        else resolve(response);
      });
      child.once("error", reject);
    });
    return new NativeClient(child, lines, identity);
  }

  command<T>(command: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Native MLS command timed out: ${String(command.command)}`)),
        nativeOperationTimeoutMs
      );
      this.#responses.push((response) => {
        clearTimeout(timer);
        if (response.ok) resolve(response.value as T);
        else reject(new Error(`${String(command.command)}: ${response.error ?? "Native MLS command failed"}`));
      });
      this.#child.stdin.write(`${JSON.stringify(command)}\n`);
    });
  }

  async close(): Promise<void> {
    this.#child.stdin.end();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#child.kill("SIGKILL");
        reject(new Error("Native MLS client did not exit"));
      }, nativeOperationTimeoutMs);
      this.#child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Native MLS client exited ${code}: ${this.#errorOutput}`));
      });
    });
    this.#lines.close();
  }
}

async function buildNativeBoundaries(): Promise<void> {
  await execFileAsync(
    rustToolchain.command,
    [
      "build",
      "--quiet",
      "--locked",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "-p",
      "mls-core",
      "--features",
      "test-fixtures",
      "--bin",
      "mls-integration-client",
      "--bin",
      "mls-keypackage-validator"
    ],
    { cwd: workspaceRoot, timeout: 240_000, maxBuffer: 2_000_000 }
  );
}

function workspace(host: DeviceIdentity, guest: DeviceIdentity): StoredRelayStateFixture {
  const createdAt = "2026-07-13T12:00:00.000Z";
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
        host: "Host",
        hostUserId: host.userId,
        activeHostDeviceId: host.deviceId,
        hostStatus: "active",
        unread: 0,
        acceptedMlsEpoch: 0
      }
    ],
    invites: [],
    teamMembers: [
      {
        teamId: "team-core",
        members: [
          { userId: host.userId, role: "owner", joinedAt: createdAt },
          { userId: guest.userId, role: "admin", joinedAt: createdAt }
        ]
      }
    ],
    devices: [host, guest].map((device) => ({
      ...device,
      displayName: device.deviceId,
      registeredAt: createdAt,
      lastSeenAt: createdAt
    })),
    inviteRequests: [],
    inviteResponses: [],
    mlsBacklog: [],
    encryptedBacklog: []
  };
}

async function authenticatedDevice(
  baseUrl: string,
  client: NativeClient
): Promise<{ headers: Record<string, string>; token: string }> {
  const { userId, deviceId } = client.identity;
  const cookie = await createDebugSession(baseUrl, userId, userId);
  const challengeResponse = await fetch(`${baseUrl}/devices/${deviceId}/challenge`, {
    method: "POST",
    headers: { cookie }
  });
  assert.equal(challengeResponse.status, 200);
  const { challenge } = (await challengeResponse.json()) as { challenge: string };
  const signed = await client.command<{ signature: string }>({ command: "signChallenge", challenge });
  const response = await fetch(`${baseUrl}/devices/${deviceId}/session`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ challenge, signature: signed.signature })
  });
  assert.equal(response.status, 200);
  const { deviceSessionToken } = (await response.json()) as { deviceSessionToken: string };
  return {
    headers: { "content-type": "application/json", cookie, "x-device-session": deviceSessionToken },
    token: deviceSessionToken
  };
}

function waitForMessage(socket: WebSocket, predicate: (message: Record<string, unknown>) => boolean) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for relay message")), 5_000);
    const listener = (raw: Buffer) => {
      const value = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off("message", listener);
      resolve(value);
    };
    socket.on("message", listener);
  });
}

async function publish(socket: WebSocket, message: Record<string, unknown>) {
  const id = String(message.id);
  const published = waitForMessage(socket, (value) => value.type === "published" && value.messageId === id);
  socket.send(JSON.stringify({ type: "publish", message }));
  await published;
}

if (rustToolchain.missing) {
  test(
    "skipped: Rust toolchain required for live native relay journey",
    { skip: "Rust toolchain required" },
    () => undefined
  );
} else {
  test("two live native MLS clients exchange an application and handoff through a real relay", async () => {
    await buildNativeBoundaries();
    const host = await NativeClient.start("github:live-host", "device-live-host");
    const guest = await NativeClient.start("github:live-guest", "device-live-guest");
    const relay = await startRelayWithWorkspace(
      { MULTAIPLAYER_RELAY_STORAGE: "sqlite", MULTAIPLAYER_MLS_VALIDATOR_PATH: validatorPath },
      workspace(host.identity, guest.identity)
    );
    const hostSocket = new WebSocket(relay.wsUrl);
    const guestSocket = new WebSocket(relay.wsUrl);
    const hostOpened = onceOpen(hostSocket);
    const guestOpened = onceOpen(guestSocket);
    try {
      const hostAuth = await authenticatedDevice(relay.baseUrl, host);
      const guestAuth = await authenticatedDevice(relay.baseUrl, guest);
      await host.command({ command: "createGroup" });
      const keyPackage = await guest.command<{ keyPackage: string; keyPackageHash: string }>({
        command: "generateKeyPackage"
      });
      const keyPackageId = `key-package-${randomUUID()}`;
      const upload = await fetch(`${relay.baseUrl}/devices/${guest.identity.deviceId}/key-packages`, {
        method: "POST",
        headers: guestAuth.headers,
        body: JSON.stringify({
          keyPackages: [{ id: keyPackageId, ...keyPackage, ciphersuite: 2 }]
        })
      });
      assert.equal(upload.status, 201);
      const admission = await host.command<{
        commit: string;
        commitOutboxId: string;
        parentEpoch: number;
        welcome: string;
      }>({
        command: "addMember",
        keyPackage: keyPackage.keyPackage
      });
      await hostOpened;
      const hostJoined = waitForJoined(hostSocket);
      hostSocket.send(
        JSON.stringify({
          type: "join",
          teamId: "team-core",
          roomId: "room-desktop",
          userId: host.identity.userId,
          deviceId: host.identity.deviceId,
          deviceSessionToken: hostAuth.token
        })
      );
      await hostJoined;
      await publish(hostSocket, {
        id: admission.commitOutboxId,
        teamId: "team-core",
        roomId: "room-desktop",
        senderUserId: host.identity.userId,
        senderDeviceId: host.identity.deviceId,
        createdAt: new Date().toISOString(),
        messageType: "commit",
        epochHint: admission.parentEpoch,
        mlsMessage: admission.commit
      });
      await host.command({ command: "publishSucceeded", messageId: admission.commitOutboxId });
      await guest.command({ command: "joinWelcome", welcome: admission.welcome });

      await guestOpened;
      const addOnGuest = waitForMessage(
        guestSocket,
        (value) => value.type === "mls.message" && (value.message as { id?: string })?.id === admission.commitOutboxId
      );
      const guestJoined = waitForJoined(guestSocket);
      guestSocket.send(
        JSON.stringify({
          type: "join",
          teamId: "team-core",
          roomId: "room-desktop",
          userId: guest.identity.userId,
          deviceId: guest.identity.deviceId,
          deviceSessionToken: guestAuth.token
        })
      );
      await Promise.all([guestJoined, addOnGuest]);

      const plaintext = "LIVE-NATIVE-RELAY-MESSAGE";
      const applicationId = `application-${randomUUID()}`;
      const encrypted = await host.command<{ message: string; messageId: string; epoch: number }>({
        command: "encrypt",
        messageId: applicationId,
        payload: plaintext,
        authenticatedData: {
          version: 1,
          messageId: applicationId,
          teamId: "team-core",
          roomId: "room-desktop",
          kind: "chat.message",
          senderUserId: host.identity.userId,
          senderDeviceId: host.identity.deviceId,
          createdAt: new Date().toISOString()
        }
      });
      const appOnGuest = waitForMessage(
        guestSocket,
        (value) => value.type === "mls.message" && (value.message as { id?: string })?.id === encrypted.messageId
      );
      await publish(hostSocket, {
        id: encrypted.messageId,
        teamId: "team-core",
        roomId: "room-desktop",
        senderUserId: host.identity.userId,
        senderDeviceId: host.identity.deviceId,
        createdAt: new Date().toISOString(),
        messageType: "application",
        epochHint: encrypted.epoch,
        mlsMessage: encrypted.message
      });
      const appEnvelope = (await appOnGuest).message as { mlsMessage: string };
      const opened = await guest.command<{ payload: string }>({ command: "process", message: appEnvelope.mlsMessage });
      assert.equal(opened.payload, plaintext);
      await host.command({ command: "publishSucceeded", messageId: encrypted.messageId });

      const handoff = await host.command<{ message: string; messageId: string; parentEpoch: number }>({
        command: "transferHost",
        nextHostUserId: guest.identity.userId,
        nextHostDeviceId: guest.identity.deviceId
      });
      const signed = await host.command<{
        authorization: Record<string, unknown>;
        signature: string;
        publicKey: string;
      }>({ command: "authorizeTransfer", commitMessageId: handoff.messageId });
      const handoffOnGuest = waitForMessage(
        guestSocket,
        (value) => value.type === "mls.message" && (value.message as { id?: string })?.id === handoff.messageId
      );
      await publish(hostSocket, {
        id: handoff.messageId,
        teamId: "team-core",
        roomId: "room-desktop",
        senderUserId: host.identity.userId,
        senderDeviceId: host.identity.deviceId,
        createdAt: new Date().toISOString(),
        messageType: "commit",
        epochHint: handoff.parentEpoch,
        mlsMessage: handoff.message,
        commitEffect: "host_handoff",
        nextHostUserId: guest.identity.userId,
        nextHostDeviceId: guest.identity.deviceId,
        hostTransferAuthorization: {
          ...signed.authorization,
          signatureDer: signed.signature,
          publicKeySpkiDer: signed.publicKey
        }
      });
      const handoffEnvelope = (await handoffOnGuest).message as { mlsMessage: string };
      await guest.command({ command: "process", message: handoffEnvelope.mlsMessage });
      await host.command({ command: "publishSucceeded", messageId: handoff.messageId });
      await assert.rejects(
        host.command({
          command: "transferHost",
          nextHostUserId: guest.identity.userId,
          nextHostDeviceId: guest.identity.deviceId
        }),
        /not the active host|host/i
      );

      const successorId = `successor-${randomUUID()}`;
      const successor = await guest.command<{ message: string; messageId: string; epoch: number }>({
        command: "encrypt",
        messageId: successorId,
        payload: "SUCCESSOR-HOST-CONTINUITY",
        authenticatedData: {
          version: 1,
          messageId: successorId,
          teamId: "team-core",
          roomId: "room-desktop",
          kind: "chat.message",
          senderUserId: guest.identity.userId,
          senderDeviceId: guest.identity.deviceId,
          createdAt: new Date().toISOString()
        }
      });
      const successorOnHost = waitForMessage(
        hostSocket,
        (value) => value.type === "mls.message" && (value.message as { id?: string })?.id === successor.messageId
      );
      await publish(guestSocket, {
        id: successor.messageId,
        teamId: "team-core",
        roomId: "room-desktop",
        senderUserId: guest.identity.userId,
        senderDeviceId: guest.identity.deviceId,
        createdAt: new Date().toISOString(),
        messageType: "application",
        epochHint: successor.epoch,
        mlsMessage: successor.message
      });
      const successorEnvelope = (await successorOnHost).message as { mlsMessage: string };
      const successorOpened = await host.command<{ payload: string }>({
        command: "process",
        message: successorEnvelope.mlsMessage
      });
      assert.equal(successorOpened.payload, "SUCCESSOR-HOST-CONTINUITY");
    } finally {
      hostSocket.close();
      guestSocket.close();
      await relay.close();
      await Promise.all([host.close(), guest.close()]);
    }
  });
}
