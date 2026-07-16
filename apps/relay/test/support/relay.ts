import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { WebSocket } from "ws";
import { codexReasoningEffortIds, maxRoomProjectPathChars } from "@multaiplayer/protocol";
import { createRelayPersistence } from "../../src/persistence.js";

const relayPackageRoot = fileURLToPath(new URL("../..", import.meta.url));
const mockValidatorPath = fileURLToPath(new URL("../fixtures/mock-keypackage-validator.mjs", import.meta.url));

export interface RelayHarness {
  baseUrl: string;
  wsUrl: string;
  dataPath: string;
  tempDir: string;
  beginShutdown(): Promise<void>;
  crash(options?: { preserveData?: boolean }): Promise<void>;
  close(options?: { preserveData?: boolean }): Promise<void>;
}

export interface StoredRelayStateFixture {
  version: 1;
  savedAt: string;
  teams: unknown;
  rooms: unknown;
  invites: unknown;
  teamMembers?: unknown[];
  devices?: unknown[];
  authSessions?: unknown[];
  accountRestrictions?: unknown[];
  attachmentBlobs?: unknown[];
  inviteRequests?: unknown[];
  inviteResponses?: unknown[];
  mlsBacklog?: unknown[];
  encryptedBacklog: unknown;
}

export interface DailyCreationQuotaErrorBody {
  error: string;
  code: string;
  retryAfterSeconds: number;
  quota: { type: string; limit: number; used: number; remaining: number; resetsAt: string };
}

export {
  Database,
  WebSocket,
  assert,
  delay,
  join,
  mkdtemp,
  randomUUID,
  readFile,
  readdir,
  resolve,
  rm,
  tmpdir,
  writeFile
};
export { codexReasoningEffortIds, maxRoomProjectPathChars };
export async function startRelay(
  extraEnv: NodeJS.ProcessEnv = {},
  storedState?: StoredRelayStateFixture,
  existingDataPath?: string
): Promise<RelayHarness> {
  const { tempDir, dataPath } = await prepareRelayStorage(storedState, existingDataPath);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = await getFreePort();
    // Launch the relay as the direct child so shutdown cannot orphan the
    // secondary Node process created by the `tsx` CLI wrapper.
    const child = spawn(process.execPath, ["--import", "tsx", "test/fixtures/relay-process.ts"], {
      cwd: relayPackageRoot,
      env: {
        ...process.env,
        MULTAIPLAYER_RELAY_DEBUG:
          extraEnv.MULTAIPLAYER_RELAY_DEBUG ?? (extraEnv.NODE_ENV === "production" ? "false" : "true"),
        MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH:
          extraEnv.MULTAIPLAYER_RELAY_UNSAFE_DISABLE_AUTH ?? (extraEnv.NODE_ENV === "production" ? "false" : "true"),
        ...extraEnv,
        ...(extraEnv.NODE_ENV === "production" && !extraEnv.MULTAIPLAYER_MLS_VALIDATOR_PATH
          ? { MULTAIPLAYER_MLS_VALIDATOR_PATH: mockValidatorPath }
          : {}),
        PORT: String(port),
        MULTAIPLAYER_RELAY_STORAGE: "sqlite",
        MULTAIPLAYER_RELAY_DATA_PATH: dataPath,
        MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH:
          extraEnv.MULTAIPLAYER_RELAY_DELETION_LEDGER_FILE_PATH ?? join(tempDir, "external-deletion-ledger"),
        MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY:
          extraEnv.MULTAIPLAYER_RELAY_DELETION_LEDGER_HMAC_KEY ??
          "relay-test-deletion-ledger-hmac-key-at-least-32-characters",
        MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS:
          extraEnv.MULTAIPLAYER_RELAY_DELETION_LEDGER_PROTECTION_SECONDS ?? "7776000"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      await waitForReady(baseUrl, child, () => output);
      return createRelayHarness(child, baseUrl, port, dataPath, tempDir);
    } catch (error) {
      lastError = error;
      await stopProcess(child);
      if (!String(error).includes("EADDRINUSE")) break;
    }
  }

  await rm(tempDir, { recursive: true, force: true });
  throw lastError;
}

async function prepareRelayStorage(storedState?: StoredRelayStateFixture, existingDataPath?: string) {
  const tempDir = existingDataPath
    ? resolve(existingDataPath, "..")
    : await mkdtemp(join(tmpdir(), "multaiplayer-relay-test-"));
  const dataPath = existingDataPath ?? join(tempDir, "relay-store.sqlite");
  const dataAlreadyExists = await access(dataPath).then(
    () => true,
    () => false
  );
  const initialState = storedState ?? (dataAlreadyExists ? undefined : defaultWorkspaceFixture());
  if (initialState) {
    const persistence = createRelayPersistence({ dataPath });
    try {
      await persistence.save(initialState);
      for (const backlog of initialState.mlsBacklog ?? []) {
        if (
          typeof backlog === "object" &&
          backlog !== null &&
          "key" in backlog &&
          typeof backlog.key === "string" &&
          "messages" in backlog &&
          Array.isArray(backlog.messages)
        ) {
          persistence.saveMlsBacklog(backlog.key as `${string}:${string}`, backlog.messages);
        }
      }
    } finally {
      persistence.close();
    }
  }
  return { tempDir, dataPath };
}

function createRelayHarness(
  child: ChildProcessWithoutNullStreams,
  baseUrl: string,
  port: number,
  dataPath: string,
  tempDir: string
): RelayHarness {
  const removeTemporaryData = async (preserveData = false) => {
    if (!preserveData) await rm(tempDir, { recursive: true, force: true });
  };
  return {
    baseUrl,
    wsUrl: `ws://127.0.0.1:${port}/rooms`,
    dataPath,
    tempDir,
    beginShutdown: () => beginProcessShutdown(child),
    async crash(options = {}) {
      await crashProcess(child);
      await removeTemporaryData(options.preserveData);
    },
    async close(options = {}) {
      await stopProcess(child);
      await removeTemporaryData(options.preserveData);
    }
  };
}

export function startRelayWithWorkspace(
  extraEnv: NodeJS.ProcessEnv = {},
  storedState?: StoredRelayStateFixture,
  existingDataPath?: string
): Promise<RelayHarness> {
  return startRelay(
    extraEnv,
    storedState ?? (existingDataPath ? undefined : defaultWorkspaceFixture()),
    existingDataPath
  );
}

export function emptyWorkspaceFixture(): StoredRelayStateFixture {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [],
    rooms: [],
    invites: [],
    teamMembers: [],
    encryptedBacklog: []
  };
}

export function defaultWorkspaceFixture(roomCount = 2, memberCount = 4): StoredRelayStateFixture {
  const rooms = [
    {
      id: "room-desktop",
      teamId: "team-core",
      name: "Desktop app",
      host: "Maddie",
      hostUserId: "github:maddiedreese",
      activeHostDeviceId: "host-device-1",
      hostStatus: "active",
      acceptedMlsEpoch: 0,
      approvalPolicy: "ask_every_turn",
      mode: { chat: true, code: true, workspace: true, browser: true },
      browserAllowedOrigins: ["https://github.com"],
      browserProfilePersistent: true,
      unread: 0
    },
    {
      id: "room-relay",
      teamId: "team-core",
      name: "Relay ops",
      host: "Alex",
      hostUserId: "github:alex",
      activeHostDeviceId: "alex-device-1",
      hostStatus: "active",
      acceptedMlsEpoch: 0,
      approvalPolicy: "ask_every_turn",
      mode: { chat: true, code: true, workspace: true, browser: false },
      browserAllowedOrigins: ["https://github.com"],
      browserProfilePersistent: true,
      unread: 0
    }
  ];
  while (rooms.length < roomCount) {
    const index = rooms.length;
    rooms.push({ ...rooms[1]!, id: `room-soak-${index}`, name: `Soak room ${index}` });
  }
  const members = [
    { teamId: "team-core", userId: "github:maddiedreese", role: "owner", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-core", userId: "github:alex", role: "admin", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-core", userId: "github:tester", role: "member", joinedAt: "2026-07-04T00:00:00.000Z" },
    { teamId: "team-core", userId: "github:design", role: "member", joinedAt: "2026-07-04T00:00:00.000Z" }
  ];
  while (members.length < memberCount) {
    const index = members.length;
    members.push({
      teamId: "team-core",
      userId: `github:soak-${index}`,
      role: "member",
      joinedAt: "2026-07-04T00:00:00.000Z"
    });
  }
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: [{ id: "team-core", name: "Core Team", members: members.length }],
    rooms,
    invites: [],
    teamMembers: [
      {
        teamId: "team-core",
        members
      }
    ],
    encryptedBacklog: []
  };
}

export async function patchHostStatus(
  baseUrl: string,
  body: { host: string; hostUserId: string; hostStatus: "active" | "handoff" | "offline" }
): Promise<number> {
  const response = await fetch(`${baseUrl}/rooms/room-desktop/host`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  await response.text();
  return response.status;
}

export async function patchRoomSettings(
  baseUrl: string,
  body: { requesterName: string; requesterUserId: string; codexModel?: string; projectPath?: string }
): Promise<number> {
  const response = await fetch(`${baseUrl}/rooms/room-desktop/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  await response.text();
  return response.status;
}

export async function postJsonStatus(baseUrl: string, path: string, body: unknown): Promise<number> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  await response.text();
  return response.status;
}

export async function createDebugSession(baseUrl: string, id: string, login: string, ttlMs?: number): Promise<string> {
  const response = await fetch(`${baseUrl}/debug/auth-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, login, name: login, ttlMs })
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0] ?? cookie;
}

export async function debugBacklog(baseUrl: string): Promise<
  Array<{
    key: string;
    envelopes: number;
    sample?: {
      id: string;
      kind: string;
      payloadAlgorithm: string;
    };
  }>
> {
  const response = await fetch(`${baseUrl}/debug/rooms`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    rooms: Array<{
      key: string;
      envelopes: number;
      sample?: {
        id: string;
        kind: string;
        payloadAlgorithm: string;
      };
    }>;
  };
  return body.rooms;
}

export async function debugRelayState(baseUrl: string): Promise<{
  invites: number;
  attachmentBlobs: number;
}> {
  const response = await fetch(`${baseUrl}/debug/rooms`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    invites?: number;
    attachmentBlobs?: number;
  };
  return {
    invites: body.invites ?? 0,
    attachmentBlobs: body.attachmentBlobs ?? 0
  };
}

export async function waitForStoredState(
  dataPath: string,
  predicate: (state: StoredRelayStateFixture) => boolean
): Promise<StoredRelayStateFixture> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const persistence = createRelayPersistence({ dataPath });
    try {
      const state = (await persistence.load()) as StoredRelayStateFixture;
      if (predicate(state)) return state;
    } catch (error) {
      lastError = error;
    } finally {
      persistence.close();
    }
    await delay(50);
  }
  assert.fail(`Timed out waiting for stored relay state: ${String(lastError)}`);
}

export async function waitForSqliteRows(
  dataPath: string,
  predicate: (state: { teams: Array<{ data_json: string }>; rooms: Array<{ data_json: string }> }) => boolean
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let db: Database.Database | null = null;
    try {
      db = new Database(dataPath, { readonly: true });
      const state = {
        teams: db.prepare("select data_json from relay_teams").all() as Array<{ data_json: string }>,
        rooms: db.prepare("select data_json from relay_rooms").all() as Array<{ data_json: string }>
      };
      if (predicate(state)) return;
    } catch (error) {
      lastError = error;
    } finally {
      db?.close();
    }
    await delay(50);
  }
  assert.fail(`Timed out waiting for SQLite relay rows: ${String(lastError)}`);
}

export async function waitForSqliteBacklogRows(
  dataPath: string,
  predicate: (rows: Array<{ rowid: number; envelope_id: string; sort_order: number; data_json: string }>) => boolean
): Promise<Array<{ rowid: number; envelope_id: string; sort_order: number; data_json: string }>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let db: Database.Database | null = null;
    try {
      db = new Database(dataPath, { readonly: true });
      const rows = db
        .prepare(
          `
        select rowid, envelope_id, sort_order, data_json
        from relay_encrypted_envelopes
        where room_key = ?
        order by sort_order, envelope_id
      `
        )
        .all("team-core:room-desktop") as Array<{
        rowid: number;
        envelope_id: string;
        sort_order: number;
        data_json: string;
      }>;
      if (predicate(rows)) return rows;
    } catch (error) {
      lastError = error;
    } finally {
      db?.close();
    }
    await delay(50);
  }
  assert.fail(`Timed out waiting for SQLite backlog rows: ${String(lastError)}`);
}

export async function waitForDebugBacklog(baseUrl: string, envelopes: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const backlog = await debugBacklog(baseUrl);
    if (backlog.some((room) => room.envelopes === envelopes)) return;
    await delay(50);
  }
  assert.fail(`Timed out waiting for debug backlog with ${envelopes} envelope(s)`);
}

export async function waitForReady(baseUrl: string, child: ChildProcessWithoutNullStreams, getOutput: () => string) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Relay exited before ready: ${getOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Keep polling until the child binds its port.
    }
    await delay(100);
  }
  throw new Error(`Relay did not become ready: ${getOutput()}`);
}

export async function waitForNotReady(baseUrl: string): Promise<{ ok: false; code: string }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      lastStatus = response.status;
      if (response.status === 503) return (await response.json()) as { ok: false; code: string };
    } catch {
      // Keep polling while the child is transitioning.
    }
    await delay(50);
  }
  assert.fail(`Timed out waiting for /readyz to become not-ready; last status ${lastStatus}`);
}

export function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.once("open", () => resolveOpen());
    socket.once("error", rejectOpen);
  });
}

export function waitForRejectedOpen(socket: WebSocket): Promise<string> {
  return new Promise((resolveReject, rejectReject) => {
    const timer = setTimeout(() => rejectReject(new Error("Timed out waiting for WebSocket rejection")), 5_000);
    socket.once("open", () => {
      clearTimeout(timer);
      rejectReject(new Error("WebSocket unexpectedly opened"));
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      resolveReject(error.message);
    });
  });
}

export function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolveClose, rejectClose) => {
    const timer = setTimeout(() => rejectClose(new Error("Timed out waiting for WebSocket close")), 5_000);
    socket.once("close", (code, reason) => {
      clearTimeout(timer);
      resolveClose({ code, reason: reason.toString() });
    });
    socket.once("error", rejectClose);
  });
}

export function waitForRoomUpdated(socket: WebSocket): Promise<{
  id: string;
  teamId: string;
  name: string;
  codexModel: string;
  approvalPolicy: string;
  browserAllowedOrigins: string[];
  browserProfilePersistent: boolean;
}> {
  return new Promise((resolveUpdate, rejectUpdate) => {
    const timer = setTimeout(() => rejectUpdate(new Error("Timed out waiting for room.updated")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type: string;
        room?: {
          id: string;
          teamId: string;
          name: string;
          codexModel: string;
          approvalPolicy: string;
          browserAllowedOrigins: string[];
          browserProfilePersistent: boolean;
        };
      };
      if (message.type === "room.updated" && message.room) {
        clearTimeout(timer);
        resolveUpdate(message.room);
      }
    });
    socket.once("error", rejectUpdate);
  });
}

export function waitForTeamUpdated(socket: WebSocket): Promise<{
  id: string;
  name: string;
  members: number;
  role?: string;
}> {
  return new Promise((resolveUpdate, rejectUpdate) => {
    const timer = setTimeout(() => rejectUpdate(new Error("Timed out waiting for team.updated")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type: string;
        message?: string;
        team?: { id: string; name: string; members: number; role?: string };
      };
      if (message.type === "team.updated" && message.team) {
        clearTimeout(timer);
        resolveUpdate(message.team);
      }
    });
    socket.once("error", rejectUpdate);
  });
}

export function waitForWorkspaceSubscribed(socket: WebSocket): Promise<void> {
  return new Promise((resolveSubscribed, rejectSubscribed) => {
    const timer = setTimeout(() => rejectSubscribed(new Error("Timed out waiting for workspace.subscribed")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string };
      if (message.type === "workspace.subscribed") {
        clearTimeout(timer);
        resolveSubscribed();
      }
    });
    socket.once("error", rejectSubscribed);
  });
}

export function waitForJoined(socket: WebSocket): Promise<void> {
  return new Promise((resolveJoin, rejectJoin) => {
    const timer = setTimeout(() => rejectJoin(new Error("Timed out waiting for joined")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string };
      if (message.type === "joined") {
        clearTimeout(timer);
        resolveJoin();
      }
    });
    socket.once("error", rejectJoin);
  });
}

export function waitForPresence(
  socket: WebSocket,
  expectedDeviceId?: string
): Promise<{
  userId: string;
  deviceId: string;
  publicKeyFingerprint?: string;
  status: string;
}> {
  return new Promise((resolvePresence, rejectPresence) => {
    const timer = setTimeout(() => rejectPresence(new Error("Timed out waiting for presence")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type: string;
        userId?: string;
        deviceId?: string;
        publicKeyFingerprint?: string;
        status?: string;
      };
      if (message.type === "error") {
        clearTimeout(timer);
        rejectPresence(new Error(message.message ?? "Relay rejected presence"));
        return;
      }
      if (
        message.type === "presence" &&
        message.userId &&
        message.deviceId &&
        message.status &&
        (!expectedDeviceId || message.deviceId === expectedDeviceId)
      ) {
        clearTimeout(timer);
        resolvePresence({
          userId: message.userId,
          deviceId: message.deviceId,
          publicKeyFingerprint: message.publicKeyFingerprint,
          status: message.status
        });
      }
    });
    socket.once("error", rejectPresence);
  });
}

export function waitForEnvelope(
  socket: WebSocket,
  kind: string,
  timeoutMs = 5_000
): Promise<{ id: string; kind: string }> {
  return new Promise((resolveEnvelope, rejectEnvelope) => {
    const timer = setTimeout(() => rejectEnvelope(new Error(`Timed out waiting for envelope ${kind}`)), timeoutMs);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type: string;
        envelope?: { id: string; kind: string };
      };
      if (message.type === "envelope" && message.envelope?.kind === kind) {
        clearTimeout(timer);
        resolveEnvelope(message.envelope);
      }
    });
    socket.once("error", rejectEnvelope);
  });
}

export function waitForPublished(socket: WebSocket, messageId: string): Promise<string> {
  return new Promise((resolvePublished, rejectPublished) => {
    const timer = setTimeout(() => rejectPublished(new Error("Timed out waiting for publish acknowledgement")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; messageId?: string };
      if (message.type === "published" && message.messageId === messageId) {
        clearTimeout(timer);
        resolvePublished(message.messageId);
      }
    });
    socket.once("error", rejectPublished);
  });
}

export function waitForError(socket: WebSocket): Promise<string> {
  return new Promise((resolveError, rejectError) => {
    const timer = setTimeout(() => rejectError(new Error("Timed out waiting for relay error")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; message?: string };
      if (message.type === "error" && message.message) {
        clearTimeout(timer);
        resolveError(message.message);
      }
    });
    socket.once("error", rejectError);
  });
}

export function waitForErrorDetails(
  socket: WebSocket
): Promise<{ message: string; code?: string; teamId?: string; roomId?: string }> {
  return new Promise((resolveError, rejectError) => {
    const timer = setTimeout(() => rejectError(new Error("Timed out waiting for relay error")), 5_000);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        type: string;
        message?: string;
        code?: string;
        teamId?: string;
        roomId?: string;
      };
      if (message.type === "error" && message.message) {
        clearTimeout(timer);
        resolveError({
          message: message.message,
          ...(message.code ? { code: message.code } : {}),
          ...(message.teamId ? { teamId: message.teamId } : {}),
          ...(message.roomId ? { roomId: message.roomId } : {})
        });
      }
    });
    socket.once("error", rejectError);
  });
}

export function testEnvelope(
  overrides: Partial<{
    id: string;
    senderDeviceId: string;
    senderUserId: string;
    teamId: string;
    roomId: string;
    createdAt: string;
    keyEpoch: number;
    kind: "browser.event" | "terminal.event" | "git.event" | "room.invite";
    payload: Record<string, unknown>;
  }> = {}
) {
  return {
    id: overrides.id ?? `envelope-${randomUUID()}`,
    teamId: overrides.teamId ?? "team-core",
    roomId: overrides.roomId ?? "room-desktop",
    senderDeviceId: overrides.senderDeviceId ?? "device-test-123",
    senderUserId: overrides.senderUserId ?? "github:tester",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    kind: overrides.kind ?? "browser.event",
    keyEpoch: overrides.keyEpoch ?? 1,
    payload: overrides.payload ?? {
      version: 2,
      algorithm: "AES-GCM-256",
      nonce: "test-nonce",
      ciphertext: "test-ciphertext"
    }
  };
}

export function deviceSealedPayload() {
  return {
    algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-256",
    ephemeralPublicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: "test-x",
      y: "test-y"
    },
    nonce: "test-nonce",
    ciphertext: "test-ciphertext"
  };
}

export async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  await beginProcessShutdown(child);
}

export async function beginProcessShutdown(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    delay(2_000).then(() => {
      child.kill("SIGKILL");
    })
  ]);
}

export async function crashProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  child.kill("SIGKILL");
  await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
}

export async function getFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) {
          resolvePort(address.port);
        } else {
          rejectPort(new Error("Could not allocate a free port"));
        }
      });
    });
  });
}
