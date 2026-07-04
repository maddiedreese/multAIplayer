import cors, { type CorsOptions } from "cors";
import cookieParser from "cookie-parser";
import express, { type CookieOptions, type NextFunction, type Request, type Response } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import { nanoid } from "nanoid";
import { WebSocketServer, type WebSocket } from "ws";
import { normalizeGitHubBranchName, normalizeGitHubRepoRef, normalizePullRequestDraft } from "@multaiplayer/github";
import {
  AttachmentBlobRecord,
  CiphertextPayload,
  RelayClientMessage,
  defaultRoomMode,
  defaultCodexModel,
  defaultBrowserAllowedOrigins,
  codexModelOptions,
  type InviteRecord,
  type AttachmentBlobRecord as AttachmentBlobRecordType,
  type DeviceRecord,
  type RoomRecord,
  type TeamRecord,
  type RelayEnvelope,
  type RelayServerMessage
} from "@multaiplayer/protocol";

loadRelayEnvFiles();

const port = Number(process.env.PORT ?? 4321);
const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubOAuthScopes = parseGitHubScopes(process.env.GITHUB_OAUTH_SCOPES);
const dataPath = resolve(process.env.MULTAIPLAYER_RELAY_DATA_PATH ?? ".multaiplayer/relay-store.json");
const encryptedBacklogLimit = parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_BACKLOG_LIMIT, 200, 1, 1000);
const encryptedBacklogRetentionDays = parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_BACKLOG_RETENTION_DAYS, 30, 1, 365);
const inviteTtlDays = parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_INVITE_TTL_DAYS, 7, 1, 365);
const attachmentBlobTtlDays = parseIntegerEnv(process.env.MULTAIPLAYER_ATTACHMENT_BLOB_TTL_DAYS, 30, 1, 365);
const attachmentBlobMaxBytes = parseIntegerEnv(process.env.MULTAIPLAYER_ATTACHMENT_BLOB_MAX_BYTES, 5_000_000, 1, 50_000_000);
const jsonBodyLimitBytes = Math.ceil(Math.max(1_000_000, attachmentBlobMaxBytes * 1.5 + 100_000));
const encryptedEnvelopeMaxBytes = parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_ENVELOPE_MAX_BYTES, 1_000_000, 4096, 5_000_000);
const sessionPersistenceSecret = normalizeSessionPersistenceSecret(process.env.MULTAIPLAYER_RELAY_SESSION_SECRET);
const debugEndpointsEnabled = process.env.NODE_ENV !== "production" || process.env.MULTAIPLAYER_RELAY_DEBUG === "true";
const allowedCorsOrigins = parseAllowedOriginEnv(process.env.MULTAIPLAYER_RELAY_ALLOWED_ORIGINS);
const seedDemoWorkspace = parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_SEED_DEMO, process.env.NODE_ENV !== "production");
const mutationsRequireAuth = parseBooleanEnv(
  process.env.MULTAIPLAYER_RELAY_REQUIRE_AUTH,
  process.env.NODE_ENV === "production"
);
const rateLimitsEnabled = parseBooleanEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMITS, true);
const rateLimitWindowMs = parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000);
const rateLimitCaps = {
  auth: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_AUTH, 30, 1, 10_000),
  read: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_READ, 300, 1, 100_000),
  mutation: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_MUTATION, 120, 1, 100_000),
  attachment: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_ATTACHMENT, 60, 1, 10_000),
  websocket: parseIntegerEnv(process.env.MULTAIPLAYER_RELAY_RATE_LIMIT_WEBSOCKET, 600, 1, 100_000)
} as const;
const corsOptions: CorsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  }
};
const app = express();
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: `${jsonBodyLimitBytes}b` }));
app.use(rateLimitMiddleware);

const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/rooms",
  maxPayload: encryptedEnvelopeMaxBytes * 2,
  verifyClient(info, done) {
    if (isAllowedCorsOrigin(info.origin)) {
      done(true);
      return;
    }
    done(false, 403, "Origin not allowed");
  }
});

type RoomKey = `${string}:${string}`;

interface ClientSession {
  socket: WebSocket;
  authSession?: AuthSession;
  rateClientId: string;
  teamId?: string;
  roomId?: string;
  userId?: string;
  deviceId?: string;
  subscribedTeamIds: Set<string>;
  workspaceSubscribed: boolean;
  displayName?: string;
  avatarUrl?: string;
}

const sessions = new Map<WebSocket, ClientSession>();
const roomSockets = new Map<RoomKey, Set<WebSocket>>();
const teamSockets = new Map<string, Set<WebSocket>>();
const workspaceSockets = new Set<WebSocket>();
const roomPresence = new Map<RoomKey, Map<string, PresenceRecord>>();
const encryptedBacklog = new Map<RoomKey, RelayEnvelope[]>();
const authSessions = new Map<string, AuthSession>();
const authSessionMaxAgeMs = 1000 * 60 * 60 * 24 * 30;
const maxRoomProjectPathChars = 2048;
const maxCodexModelChars = 80;
const maxTeamNameChars = 120;
const maxRoomNameChars = 160;
const maxDisplayNameChars = 120;
const maxUserIdChars = 160;
const maxDeviceIdChars = 160;
const maxHostNameChars = 120;
const maxPublicKeyFingerprintChars = 128;
const maxPublicKeyJwkChars = 4096;
const maxEnvelopeIdChars = 160;
const maxEnvelopeNonceChars = 512;
const maxEnvelopeCiphertextChars = Math.ceil(encryptedEnvelopeMaxBytes * 4 / 3) + 1024;
const teams = new Map<string, TeamRecord>();
const rooms = new Map<string, RoomRecord>();
const invites = new Map<string, InviteRecord>();
const devices = new Map<string, DeviceRecord>();
const attachmentBlobs = new Map<string, AttachmentBlobRecordType>();
const teamMembers = new Map<string, Set<string>>();
const rateLimitStore = new Map<string, RateLimitRecord>();
let saveTimer: NodeJS.Timeout | null = null;

type RateLimitBucket = keyof typeof rateLimitCaps;

function authCookieOptions(maxAge?: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(maxAge === undefined ? {} : { maxAge })
  };
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface AuthSession {
  accessToken: string;
  user: {
    id: string;
    login: string;
    name?: string;
    avatarUrl?: string;
  };
  expiresAt: number;
}

interface StoredAuthSession {
  sessionId: string;
  user: AuthSession["user"];
  expiresAt: number;
  accessToken?: string;
  encryptedAccessToken?: {
    algorithm: "AES-GCM-256";
    nonce: string;
    ciphertext: string;
    tag: string;
  };
}

interface StoredRelayState {
  version: 1;
  savedAt: string;
	  teams: TeamRecord[];
	  rooms: RoomRecord[];
	  invites: InviteRecord[];
	  devices?: DeviceRecord[];
	  teamMembers?: Array<{
	    teamId: string;
	    userIds: string[];
	  }>;
	  authSessions?: StoredAuthSession[];
	  attachmentBlobs?: AttachmentBlobRecordType[];
	  encryptedBacklog: Array<{
	    key: RoomKey;
	    envelopes: RelayEnvelope[];
  }>;
}

interface PresenceRecord {
  teamId: string;
  roomId: string;
  userId: string;
  deviceId: string;
  displayName: string;
  avatarUrl?: string;
  publicKeyFingerprint?: string;
}

await loadRelayStore();
seedWorkspace();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "multaiplayer-relay" });
});

app.get("/readyz", (_req, res) => {
  res.json({ ok: true, dataPath });
});

app.get("/auth/config", (_req, res) => {
  res.json({
    provider: "github",
    configured: Boolean(githubClientId),
    scopes: githubOAuthScopes,
    mutationsRequireAuth,
    allowedOrigins: allowedCorsOrigins,
    sessionPersistence: sessionPersistenceSecret ? "encrypted" : "memory_only"
  });
});

app.post("/auth/github/device/start", async (_req, res) => {
  if (!githubClientId) {
    res.status(503).json({
      error: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID on the relay."
    });
    return;
  }

  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      client_id: githubClientId,
      scope: githubOAuthScopes.join(" ")
    })
  });

  res.status(response.status).json(await response.json());
});

app.post("/auth/github/device/poll", async (req, res) => {
  if (!githubClientId) {
    res.status(503).json({
      error: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID on the relay."
    });
    return;
  }

  const deviceCode = String(req.body?.device_code ?? "");
  if (!deviceCode) {
    res.status(400).json({ error: "device_code is required" });
    return;
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      client_id: githubClientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    })
  });
  const tokenBody = await tokenResponse.json() as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenBody.access_token) {
    res.status(202).json(tokenBody);
    return;
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${tokenBody.access_token}`,
      accept: "application/vnd.github+json",
      "user-agent": "multAIplayer-alpha"
    }
  });
  if (!userResponse.ok) {
    res.status(userResponse.status).json({ error: "Failed to load GitHub user" });
    return;
  }
  const githubUser = await userResponse.json() as {
    id: number;
    login: string;
    name?: string | null;
    avatar_url?: string;
  };

  const sessionId = nanoid(32);
  const session: AuthSession = {
    accessToken: tokenBody.access_token,
    user: {
      id: `github:${githubUser.id}`,
      login: githubUser.login,
      name: githubUser.name ?? undefined,
      avatarUrl: githubUser.avatar_url
    },
    expiresAt: Date.now() + authSessionMaxAgeMs
  };
  authSessions.set(sessionId, session);
  scheduleStoreSave();
  res.cookie("multaiplayer_session", sessionId, authCookieOptions(authSessionMaxAgeMs));
  res.json({ user: session.user });
});

app.get("/auth/me", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!session) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  res.json({ user: session.user });
});

app.post("/auth/logout", (req, res) => {
  const sessionId = req.cookies?.multaiplayer_session;
  if (sessionId) {
    authSessions.delete(sessionId);
    scheduleStoreSave();
  }
  res.clearCookie("multaiplayer_session", authCookieOptions());
  res.json({ ok: true });
});

app.post("/github/pulls", async (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!session) {
    res.status(401).json({ error: "Sign in with GitHub before creating a PR." });
    return;
  }

  let draft;
  try {
    draft = normalizePullRequestDraft({
      owner: String(req.body?.owner ?? ""),
      repo: String(req.body?.repo ?? ""),
      title: String(req.body?.title ?? ""),
      body: String(req.body?.body ?? ""),
      head: String(req.body?.head ?? ""),
      base: String(req.body?.base ?? "main"),
      draft: Boolean(req.body?.draft ?? true)
    });
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
    return;
  }

  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(draft.owner)}/${encodeURIComponent(draft.repo)}/pulls`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "multAIplayer-alpha"
    },
    body: JSON.stringify(draft)
  });
  const responseBody = await response.json();
  if (!response.ok) {
    res.status(response.status).json(responseBody);
    return;
  }
  res.status(201).json({
    id: responseBody.id,
    number: responseBody.number,
    url: responseBody.html_url,
    title: responseBody.title
  });
});

app.get("/github/actions/runs", async (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!session) {
    res.status(401).json({ error: "Sign in with GitHub before checking Actions." });
    return;
  }

  let repoRef;
  let branch: string | null = null;
  try {
    repoRef = normalizeGitHubRepoRef(String(req.query.owner ?? ""), String(req.query.repo ?? ""));
    const requestedBranch = String(req.query.branch ?? "");
    branch = requestedBranch.trim() ? normalizeGitHubBranchName(requestedBranch) : null;
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) });
    return;
  }

  const params = new URLSearchParams({ per_page: "6" });
  if (branch) params.set("branch", branch);
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}/actions/runs?${params}`, {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "multAIplayer-alpha",
      "x-github-api-version": "2022-11-28"
    }
  });
  const responseBody = await response.json();
  if (!response.ok) {
    res.status(response.status).json(responseBody);
    return;
  }

  res.json({
    totalCount: responseBody.total_count ?? 0,
    runs: (responseBody.workflow_runs ?? []).slice(0, 6).map((run: Record<string, unknown>) => ({
      id: run.id,
      name: run.name,
      displayTitle: run.display_title,
      runNumber: run.run_number,
      workflowId: run.workflow_id,
      status: run.status,
      conclusion: run.conclusion,
      branch: run.head_branch,
      headSha: run.head_sha,
      event: run.event,
      url: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at
    }))
  });
});

app.get("/teams", (_req, res) => {
  const session = getAuthSession(_req.cookies?.multaiplayer_session);
  if (!allowRead(session, res)) return;
  const visibleTeamIds = session ? teamIdsForUser(session.user.id) : new Set(teams.keys());
  res.json({
    teams: Array.from(teams.values()).filter((team) => visibleTeamIds.has(team.id)),
    rooms: Array.from(rooms.values()).filter((room) => visibleTeamIds.has(room.teamId))
  });
});

app.post("/devices", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;

  const requestedUserId = normalizeOptionalMetadataText(req.body?.userId, maxUserIdChars);
  if (requestedUserId === null) {
    res.status(400).json({ error: `userId must be up to ${maxUserIdChars} characters without control characters` });
    return;
  }
  if (session && requestedUserId && requestedUserId !== session.user.id) {
    res.status(403).json({ error: "Device user id must match the signed-in GitHub user." });
    return;
  }
  const userId = session?.user.id ?? requestedUserId;
  const deviceId = normalizeMetadataText(req.body?.deviceId, maxDeviceIdChars);
  const displayName = session
    ? normalizeMetadataText(displayNameForUser(session.user), maxDisplayNameChars)
    : normalizeMetadataText(req.body?.displayName, maxDisplayNameChars);
  const publicKeyJwk = req.body?.publicKeyJwk;
  const publicKeyFingerprint = normalizeMetadataText(req.body?.publicKeyFingerprint, maxPublicKeyFingerprintChars);
  if (!userId || !deviceId || !displayName) {
    res.status(400).json({ error: "userId, deviceId, and displayName are required" });
    return;
  }
  if (!isRecord(publicKeyJwk) || !publicKeyFingerprint || !isJsonStringifiableWithin(publicKeyJwk, maxPublicKeyJwkChars)) {
    res.status(400).json({ error: "A public key JWK and fingerprint are required" });
    return;
  }

  const now = new Date().toISOString();
  const key = deviceKey(userId, deviceId);
  const existing = devices.get(key);
  const device: DeviceRecord = {
    userId,
    deviceId,
    displayName,
    publicKeyJwk,
    publicKeyFingerprint,
    registeredAt: existing?.registeredAt ?? now,
    lastSeenAt: now
  };
  devices.set(key, device);
  scheduleStoreSave();
  res.status(existing ? 200 : 201).json({ device });
});

app.post("/teams", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;

  const name = normalizeMetadataText(req.body?.name, maxTeamNameChars);
  if (!name) {
    res.status(400).json({ error: `Team name is required and must be up to ${maxTeamNameChars} characters` });
    return;
  }
  const team: TeamRecord = {
    id: `team_${nanoid(10)}`,
    name,
    members: 1
  };
  teams.set(team.id, team);
  if (session?.user.id) {
    teamMembers.set(team.id, new Set([session.user.id]));
  }
  scheduleStoreSave();
  broadcastWorkspaceUpdated(team);
  res.status(201).json({ team });
});

app.post("/rooms", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;

  const teamId = String(req.body?.teamId ?? "");
  const name = normalizeMetadataText(req.body?.name, maxRoomNameChars);
  const projectPath = normalizeRoomProjectPath(req.body?.projectPath);
  if (!teams.has(teamId)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (session && !isTeamMember(teamId, session.user.id)) {
    res.status(403).json({ error: "Join this team before creating rooms." });
    return;
  }
  if (!name) {
    res.status(400).json({ error: `Room name is required and must be up to ${maxRoomNameChars} characters` });
    return;
  }
  if (!projectPath) {
    res.status(400).json({ error: `projectPath must be a non-empty string up to ${maxRoomProjectPathChars} characters` });
    return;
  }
  const room: RoomRecord = {
    id: `room_${nanoid(10)}`,
    teamId,
    name,
    projectPath,
    host: "No host",
    hostStatus: "offline",
    approvalPolicy: "ask_every_turn",
    mode: defaultRoomMode,
    codexModel: defaultCodexModel,
    browserAllowedOrigins: defaultBrowserAllowedOrigins,
    unread: 0
  };
  rooms.set(room.id, room);
  scheduleStoreSave();
  broadcastRoomUpdated(room);
  res.status(201).json({ room });
});

app.patch("/rooms/:roomId/host", (req, res) => {
  const roomId = String(req.params.roomId ?? "");
  const host = normalizeOptionalMetadataText(req.body?.host, maxHostNameChars);
  const requestedHostUserId = normalizeOptionalMetadataText(req.body?.hostUserId, maxUserIdChars);
  const hostStatus = String(req.body?.hostStatus ?? "");
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;
  if (host === null || requestedHostUserId === null) {
    res.status(400).json({ error: "Host name and user id must be bounded strings without control characters" });
    return;
  }

  const requester = {
    id: session?.user.id ?? requestedHostUserId,
    name: session ? (normalizeMetadataText(displayNameForUser(session.user), maxHostNameChars) ?? "") : host
  };
  const room = rooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (session && !canAccessRoom(room.teamId, room.id, session.user.id)) {
    res.status(403).json({ error: "Join this room before changing host state." });
    return;
  }
  if (!["active", "offline", "handoff"].includes(hostStatus)) {
    res.status(400).json({ error: "hostStatus must be active, offline, or handoff" });
    return;
  }
  if (!requester.name || !requester.id) {
    res.status(400).json({ error: "Host name and user id are required" });
    return;
  }

  if (hostStatus === "active" && room.hostStatus === "active" && !isRoomHost(room, requester)) {
    res.status(409).json({ error: `${room.host} is already the active host. Ask them to hand off or release the room first.` });
    return;
  }

  if (hostStatus !== "active" && !isRoomHost(room, requester)) {
    res.status(403).json({ error: "Only the active host can hand off or release this room." });
    return;
  }

  const updated: RoomRecord = {
    ...room,
    host: hostStatus === "offline" ? "No host" : hostStatus === "active" ? requester.name : room.host,
    hostUserId: hostStatus === "offline" ? undefined : hostStatus === "active" ? requester.id : room.hostUserId,
    hostStatus: hostStatus as RoomRecord["hostStatus"]
  };
  rooms.set(roomId, updated);
  scheduleStoreSave();
  broadcastRoomUpdated(updated);
  res.json({ room: updated });
});

app.patch("/rooms/:roomId/settings", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;

  const roomId = String(req.params.roomId ?? "");
  const approvalPolicy = req.body?.approvalPolicy === undefined ? undefined : String(req.body.approvalPolicy);
  const mode = req.body?.mode;
  const codexModel = req.body?.codexModel === undefined ? undefined : normalizeCodexModel(req.body.codexModel);
  const projectPath = req.body?.projectPath === undefined ? undefined : normalizeRoomProjectPath(req.body.projectPath);
  const browserAllowedOrigins = req.body?.browserAllowedOrigins;
  const requester = requesterFromRequest(req.body, req.cookies?.multaiplayer_session);
  const room = rooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (session && !canAccessRoom(room.teamId, room.id, session.user.id)) {
    res.status(403).json({ error: "Join this room before changing room settings." });
    return;
  }
  if (room.hostStatus === "active" && !isRoomHost(room, requester)) {
    res.status(403).json({ error: "Only the active host can change room settings." });
    return;
  }
  if (approvalPolicy !== undefined && !isApprovalPolicy(approvalPolicy)) {
    res.status(400).json({ error: "approvalPolicy is invalid" });
    return;
  }
  if (mode !== undefined && !isRoomMode(mode)) {
    res.status(400).json({ error: "mode must include boolean chat, code, workspace, and browser fields" });
    return;
  }
  if (codexModel !== undefined && !codexModel) {
    res.status(400).json({ error: `codexModel must be a known model id or a model-like id up to ${maxCodexModelChars} characters` });
    return;
  }
  if (projectPath !== undefined && !projectPath) {
    res.status(400).json({ error: `projectPath must be a non-empty string up to ${maxRoomProjectPathChars} characters` });
    return;
  }
  const normalizedBrowserAllowedOrigins = browserAllowedOrigins === undefined
    ? undefined
    : normalizeBrowserAllowedOrigins(browserAllowedOrigins);
  if (browserAllowedOrigins !== undefined && normalizedBrowserAllowedOrigins === null) {
    res.status(400).json({ error: "browserAllowedOrigins must be up to 20 http(s) origins such as https://github.com" });
    return;
  }

  const updated: RoomRecord = {
    ...room,
    projectPath: projectPath ?? room.projectPath,
    approvalPolicy: approvalPolicy ?? room.approvalPolicy,
    mode: mode ?? room.mode,
    codexModel: codexModel ?? room.codexModel,
    browserAllowedOrigins: normalizedBrowserAllowedOrigins ?? room.browserAllowedOrigins
  };
  rooms.set(roomId, updated);
  scheduleStoreSave();
  broadcastRoomUpdated(updated);
  res.json({ room: updated });
});

app.get("/debug/rooms", (_req, res) => {
  if (!debugEndpointsEnabled) {
    res.status(404).json({ error: "Debug endpoints are disabled." });
    return;
  }
  pruneExpiredRelayState();
  res.json({
    invites: invites.size,
    attachmentBlobs: attachmentBlobs.size,
    rooms: Array.from(encryptedBacklog.entries()).map(([key, envelopes]) => ({
      key,
      envelopes: envelopes.length,
      sample: envelopes.at(-1)
        ? {
            id: envelopes.at(-1)?.id,
            kind: envelopes.at(-1)?.kind,
            payloadAlgorithm: envelopes.at(-1)?.payload.algorithm,
            ciphertextBytes: envelopes.at(-1)?.payload.ciphertext.length
          }
        : null
    }))
  });
});

app.post("/debug/auth-session", (req, res) => {
  if (!debugEndpointsEnabled) {
    res.status(404).json({ error: "Debug endpoints are disabled." });
    return;
  }
  const id = String(req.body?.id ?? "").trim();
  const login = String(req.body?.login ?? id.replace(/^github:/, "")).trim();
  const name = String(req.body?.name ?? login).trim();
  const ttlMs = parseIntegerValue(req.body?.ttlMs, 1000 * 60 * 60, -1000 * 60 * 60, authSessionMaxAgeMs);
  if (!id || !login) {
    res.status(400).json({ error: "id and login are required" });
    return;
  }
  const sessionId = nanoid(32);
  const session: AuthSession = {
    accessToken: "debug-token",
    user: { id, login, name },
    expiresAt: Date.now() + ttlMs
  };
  authSessions.set(sessionId, session);
  scheduleStoreSave();
  res.cookie("multaiplayer_session", sessionId, authCookieOptions(ttlMs));
  res.status(201).json({ user: session.user });
});

app.post("/invites", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;

  const teamId = String(req.body?.teamId ?? "");
  const roomId = String(req.body?.roomId ?? "");
  if (!teams.has(teamId)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (!rooms.has(roomId) || rooms.get(roomId)?.teamId !== teamId) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (session && !canAccessRoom(teamId, roomId, session.user.id)) {
    res.status(403).json({ error: "Join this room before creating invites." });
    return;
  }

  const invite: InviteRecord = {
    id: `invite_${nanoid(16)}`,
    teamId,
    roomId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + inviteTtlDays * 24 * 60 * 60 * 1000).toISOString()
  };
  invites.set(invite.id, invite);
  scheduleStoreSave();
  res.status(201).json({ invite });
});

app.get("/invites/:inviteId", (req, res) => {
  const invite = invites.get(req.params.inviteId);
  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    invites.delete(invite.id);
    scheduleStoreSave();
    res.status(410).json({ error: "Invite expired" });
    return;
  }

  const team = teams.get(invite.teamId);
  const room = rooms.get(invite.roomId);
  if (!team || !room) {
    res.status(404).json({ error: "Invite target no longer exists" });
    return;
  }

  res.json({ invite, team, room });
});

app.post("/attachment-blobs", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;

  const teamId = String(req.body?.teamId ?? "");
  const roomId = String(req.body?.roomId ?? "");
  if (!teams.has(teamId)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (!rooms.has(roomId) || rooms.get(roomId)?.teamId !== teamId) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  if (session && !canAccessRoom(teamId, roomId, session.user.id)) {
    res.status(403).json({ error: "Join this room before uploading attachment blobs." });
    return;
  }

  const name = String(req.body?.name ?? "").trim();
  const type = String(req.body?.type ?? "file").trim() || "file";
  const size = Number(req.body?.size);
  const payload = CiphertextPayload.safeParse(req.body?.payload);
  if (!name || name.length > 512) {
    res.status(400).json({ error: "name must be a non-empty string up to 512 characters" });
    return;
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    res.status(400).json({ error: "size must be a non-negative integer" });
    return;
  }
  if (size > attachmentBlobMaxBytes) {
    res.status(413).json({ error: `Attachment blob size exceeds ${attachmentBlobMaxBytes} bytes` });
    return;
  }
  if (!payload.success) {
    res.status(400).json({ error: "payload must be a valid ciphertext payload" });
    return;
  }
  if (payload.data.ciphertext.length > maxCiphertextCharactersForBlob(attachmentBlobMaxBytes)) {
    res.status(413).json({ error: `Attachment blob ciphertext exceeds ${attachmentBlobMaxBytes} bytes` });
    return;
  }

  const blob: AttachmentBlobRecordType = {
    id: `blob_${nanoid(16)}`,
    teamId,
    roomId,
    name,
    type,
    size,
    payload: payload.data,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + attachmentBlobTtlDays * 24 * 60 * 60 * 1000).toISOString()
  };
  attachmentBlobs.set(blob.id, blob);
  scheduleStoreSave();
  res.status(201).json({ blob });
});

app.get("/attachment-blobs/:blobId", (req, res) => {
  const blob = attachmentBlobs.get(req.params.blobId);
  if (!blob) {
    res.status(404).json({ error: "Attachment blob not found" });
    return;
  }
  const teamId = String(req.query.teamId ?? "");
  const roomId = String(req.query.roomId ?? "");
  if (!teamId || !roomId) {
    res.status(400).json({ error: "teamId and roomId are required" });
    return;
  }
  if (blob.teamId !== teamId || blob.roomId !== roomId) {
    res.status(404).json({ error: "Attachment blob not found" });
    return;
  }
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowRead(session, res)) return;
  if (session && !canAccessRoom(teamId, roomId, session.user.id)) {
    res.status(403).json({ error: "Join this room before reading attachment blobs." });
    return;
  }
  if (isExpiredAttachmentBlob(blob)) {
    attachmentBlobs.delete(blob.id);
    scheduleStoreSave();
    res.status(410).json({ error: "Attachment blob expired" });
    return;
  }
  res.json({ blob });
});

wss.on("connection", (socket, request) => {
  const session: ClientSession = {
    socket,
    authSession: getAuthSessionFromRequest(request),
    rateClientId: clientIdentityFromIncomingMessage(request),
    subscribedTeamIds: new Set<string>(),
    workspaceSubscribed: false
  };
  sessions.set(socket, session);

  socket.on("message", (raw) => {
    try {
      if (!consumeRateLimit("websocket", session.rateClientId).allowed) {
        send(socket, { type: "error", message: "Rate limit exceeded. Slow down before sending more room events." });
        return;
      }
      const parsed = RelayClientMessage.parse(JSON.parse(raw.toString()));
      if (parsed.type === "join") {
        if (!isBoundedSocketIdentity(parsed.userId, parsed.deviceId)) {
          send(socket, { type: "error", message: "WebSocket user and device ids must be bounded strings without control characters." });
          return;
        }
        if (parsed.inviteId && !normalizeMetadataText(parsed.inviteId, maxEnvelopeIdChars)) {
          send(socket, { type: "error", message: "Invite id must be a bounded string without control characters." });
          return;
        }
        if (!isKnownRoom(parsed.teamId, parsed.roomId)) {
          send(socket, { type: "error", message: "Room not found" });
          return;
        }
        if (!canJoinRoom(session, parsed.teamId, parsed.roomId, parsed.userId, parsed.inviteId)) {
          send(socket, { type: "error", message: "Sign in and use a valid invite before joining this room." });
          return;
        }
        joinRoom(session, parsed.teamId, parsed.roomId, parsed.userId, parsed.deviceId);
        send(socket, { type: "joined", teamId: parsed.teamId, roomId: parsed.roomId });
        for (const envelope of encryptedBacklog.get(roomKey(parsed.teamId, parsed.roomId)) ?? []) {
          send(socket, { type: "envelope", envelope });
        }
        for (const presence of roomPresence.get(roomKey(parsed.teamId, parsed.roomId))?.values() ?? []) {
          send(socket, { type: "presence", ...presence, status: "online" });
        }
        return;
      }

      if (parsed.type === "subscribe.team") {
        if (!isBoundedSocketIdentity(parsed.userId, parsed.deviceId)) {
          send(socket, { type: "error", message: "WebSocket user and device ids must be bounded strings without control characters." });
          return;
        }
        if (!teams.has(parsed.teamId)) {
          send(socket, { type: "error", message: "Team not found" });
          return;
        }
        if (!canSubscribeTeam(session, parsed.teamId, parsed.userId)) {
          send(socket, { type: "error", message: "Join this team before subscribing to it." });
          return;
        }
        subscribeTeam(session, parsed.teamId);
        send(socket, { type: "team.subscribed", teamId: parsed.teamId });
        return;
      }

      if (parsed.type === "subscribe.workspace") {
        if (!isBoundedSocketIdentity(parsed.userId, parsed.deviceId)) {
          send(socket, { type: "error", message: "WebSocket user and device ids must be bounded strings without control characters." });
          return;
        }
        if (!canSubscribeWorkspace(session, parsed.userId)) {
          send(socket, { type: "error", message: "Sign in before subscribing to the workspace." });
          return;
        }
        subscribeWorkspace(session);
        send(socket, { type: "workspace.subscribed" });
        return;
      }

      if (parsed.type === "publish") {
        if (!canPublishEnvelope(session, parsed.envelope)) {
          send(socket, { type: "error", message: "Join the room before publishing with this user and device." });
          return;
        }
        if (!isAllowedEnvelopePayload(parsed.envelope)) {
          send(socket, { type: "error", message: "Device-sealed envelopes are only supported for room invites." });
          return;
        }
        if (!isRelayEnvelopeWithinLimits(parsed.envelope)) {
          send(socket, { type: "error", message: `Encrypted room envelope exceeds relay limits (${encryptedEnvelopeMaxBytes} bytes max).` });
          return;
        }
        publishEnvelope(parsed.envelope);
        return;
      }

      if (!isPresenceForJoinedSession(session, parsed)) {
        send(socket, { type: "error", message: "Join the room before publishing presence with this user and device." });
        return;
      }
      if (!isPresenceWithinLimits(parsed)) {
        send(socket, { type: "error", message: "Presence display name, avatar URL, and fingerprint must be bounded strings without control characters." });
        return;
      }
      publishPresence(session, parsed.teamId, parsed.roomId, {
        teamId: parsed.teamId,
        roomId: parsed.roomId,
        userId: parsed.userId,
        deviceId: parsed.deviceId,
        displayName: parsed.displayName,
        avatarUrl: parsed.avatarUrl,
        publicKeyFingerprint: parsed.publicKeyFingerprint
      });
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Invalid relay message"
      });
    }
  });

  socket.on("close", () => {
    leaveRoom(session);
    leaveTeams(session);
    leaveWorkspace(session);
    sessions.delete(socket);
  });
});

function joinRoom(session: ClientSession, teamId: string, roomId: string, userId: string, deviceId: string) {
  leaveRoom(session);
  session.teamId = teamId;
  session.roomId = roomId;
  session.userId = userId;
  session.deviceId = deviceId;
  const key = roomKey(teamId, roomId);
  const sockets = roomSockets.get(key) ?? new Set<WebSocket>();
  sockets.add(session.socket);
  roomSockets.set(key, sockets);
}

function subscribeTeam(session: ClientSession, teamId: string) {
  session.subscribedTeamIds.add(teamId);
  const sockets = teamSockets.get(teamId) ?? new Set<WebSocket>();
  sockets.add(session.socket);
  teamSockets.set(teamId, sockets);
}

function subscribeWorkspace(session: ClientSession) {
  session.workspaceSubscribed = true;
  workspaceSockets.add(session.socket);
}

function isKnownRoom(teamId: string, roomId: string): boolean {
  return rooms.get(roomId)?.teamId === teamId;
}

function canPublishEnvelope(session: ClientSession, envelope: RelayEnvelope): boolean {
  return (
    session.teamId === envelope.teamId &&
    session.roomId === envelope.roomId &&
    session.userId === envelope.senderUserId &&
    session.deviceId === envelope.senderDeviceId
  );
}

function isAllowedEnvelopePayload(envelope: RelayEnvelope): boolean {
  if (envelope.payload.algorithm === "AES-GCM-256") return true;
  return envelope.kind === "room.invite";
}

function isRelayEnvelopeWithinLimits(envelope: RelayEnvelope): boolean {
  if (!normalizeMetadataText(envelope.id, maxEnvelopeIdChars)) return false;
  if (!normalizeMetadataText(envelope.senderUserId, maxUserIdChars)) return false;
  if (!normalizeMetadataText(envelope.senderDeviceId, maxDeviceIdChars)) return false;
  if (!normalizeMetadataText(envelope.payload.nonce, maxEnvelopeNonceChars)) return false;
  if (!envelope.payload.ciphertext || envelope.payload.ciphertext.length > maxEnvelopeCiphertextChars) return false;
  if (envelope.payload.algorithm === "ECDH-P256-HKDF-SHA256-AES-GCM-256") {
    if (!isJsonStringifiableWithin(envelope.payload.ephemeralPublicKeyJwk, maxPublicKeyJwkChars)) return false;
  }
  return Buffer.byteLength(JSON.stringify(envelope), "utf8") <= encryptedEnvelopeMaxBytes;
}

function isBoundedSocketIdentity(userId: string, deviceId: string): boolean {
  return Boolean(
    normalizeMetadataText(userId, maxUserIdChars) &&
    normalizeMetadataText(deviceId, maxDeviceIdChars)
  );
}

function isPresenceWithinLimits(presence: PresenceRecord): boolean {
  if (!normalizeMetadataText(presence.displayName, maxDisplayNameChars)) return false;
  if (presence.avatarUrl !== undefined && !normalizeMetadataText(presence.avatarUrl, maxRoomProjectPathChars)) return false;
  if (
    presence.publicKeyFingerprint !== undefined &&
    !normalizeMetadataText(presence.publicKeyFingerprint, maxPublicKeyFingerprintChars)
  ) {
    return false;
  }
  return true;
}

function isPresenceForJoinedSession(
  session: ClientSession,
  presence: Pick<PresenceRecord, "teamId" | "roomId" | "userId" | "deviceId">
): boolean {
  return (
    session.teamId === presence.teamId &&
    session.roomId === presence.roomId &&
    session.userId === presence.userId &&
    session.deviceId === presence.deviceId
  );
}

function leaveRoom(session: ClientSession) {
  if (!session.teamId || !session.roomId) return;
  const key = roomKey(session.teamId, session.roomId);
  if (session.deviceId) {
    const roster = roomPresence.get(key);
    const presence = roster?.get(session.deviceId);
    if (presence) {
      roster?.delete(session.deviceId);
      if (roster?.size === 0) roomPresence.delete(key);
      broadcast(key, { type: "presence", ...presence, status: "offline" });
    }
  }
  const sockets = roomSockets.get(key);
  sockets?.delete(session.socket);
  if (sockets?.size === 0) roomSockets.delete(key);
}

function leaveTeams(session: ClientSession) {
  for (const teamId of session.subscribedTeamIds) {
    const sockets = teamSockets.get(teamId);
    sockets?.delete(session.socket);
    if (sockets?.size === 0) teamSockets.delete(teamId);
  }
  session.subscribedTeamIds.clear();
}

function leaveWorkspace(session: ClientSession) {
  if (!session.workspaceSubscribed) return;
  workspaceSockets.delete(session.socket);
  session.workspaceSubscribed = false;
}

function publishEnvelope(envelope: RelayEnvelope) {
  const key = roomKey(envelope.teamId, envelope.roomId);
  const backlog = encryptedBacklog.get(key) ?? [];
  if (backlog.some((existing) => existing.id === envelope.id)) return;
  backlog.push(envelope);
  encryptedBacklog.set(key, pruneEncryptedBacklog(backlog));
  scheduleStoreSave();
  broadcast(key, { type: "envelope", envelope });
}

function publishPresence(session: ClientSession, teamId: string, roomId: string, presence: PresenceRecord) {
  session.displayName = presence.displayName;
  session.avatarUrl = presence.avatarUrl;
  addTeamMember(teamId, presence.userId);
  const registeredDevice = devices.get(deviceKey(presence.userId, presence.deviceId));
  const verifiedPresence: PresenceRecord = {
    ...presence,
    publicKeyFingerprint: registeredDevice?.publicKeyFingerprint ?? presence.publicKeyFingerprint
  };
  const key = roomKey(teamId, roomId);
  const roster = roomPresence.get(key) ?? new Map<string, PresenceRecord>();
  roster.set(verifiedPresence.deviceId, verifiedPresence);
  roomPresence.set(key, roster);
  broadcast(key, { type: "presence", ...verifiedPresence, status: "online" });
}

function addTeamMember(teamId: string, userId: string) {
  if (!userId) return;
  const team = teams.get(teamId);
  if (!team) return;
  const members = teamMembers.get(teamId) ?? new Set<string>();
  if (members.has(userId)) return;
  members.add(userId);
  teamMembers.set(teamId, members);
  const updated: TeamRecord = {
    ...team,
    members: Math.max(team.members, members.size)
  };
  teams.set(teamId, updated);
  scheduleStoreSave();
  broadcastWorkspaceUpdated(updated);
}

function broadcast(key: RoomKey, message: RelayServerMessage) {
  const sockets = roomSockets.get(key);
  if (!sockets) return;
  for (const socket of sockets) {
    send(socket, message);
  }
}

function broadcastRoomUpdated(room: RoomRecord) {
  const sockets = new Set<WebSocket>();
  for (const socket of roomSockets.get(roomKey(room.teamId, room.id)) ?? []) sockets.add(socket);
  for (const socket of teamSockets.get(room.teamId) ?? []) sockets.add(socket);
  for (const socket of sockets) send(socket, { type: "room.updated", room });
}

function broadcastWorkspaceUpdated(team: TeamRecord) {
  for (const socket of workspaceSockets) send(socket, { type: "team.updated", team });
}

function send(socket: WebSocket, message: RelayServerMessage) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function roomKey(teamId: string, roomId: string): RoomKey {
  return `${teamId}:${roomId}`;
}

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const bucket = rateLimitBucketForRequest(req);
  if (!bucket) {
    next();
    return;
  }
  const result = consumeRateLimit(bucket, clientIdentityFromRequest(req));
  if (result.allowed) {
    next();
    return;
  }
  res.setHeader("Retry-After", String(Math.ceil(Math.max(0, result.resetAt - Date.now()) / 1000)));
  res.status(429).json({
    error: "Rate limit exceeded. Slow down before retrying.",
    bucket,
    retryAfterSeconds: Math.ceil(Math.max(0, result.resetAt - Date.now()) / 1000)
  });
}

function rateLimitBucketForRequest(req: Request): RateLimitBucket | null {
  if (req.path === "/healthz" || req.path === "/readyz" || req.path === "/auth/config") return null;
  if (req.path.startsWith("/auth/")) return "auth";
  if (req.path.startsWith("/attachment-blobs")) return "attachment";
  if (req.method === "GET") return "read";
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return "mutation";
  return null;
}

function consumeRateLimit(bucket: RateLimitBucket, clientId: string): { allowed: true; resetAt: number } | { allowed: false; resetAt: number } {
  if (!rateLimitsEnabled) return { allowed: true, resetAt: Date.now() + rateLimitWindowMs };
  const now = Date.now();
  pruneRateLimitStore(now);
  const key = `${bucket}:${clientId}`;
  const current = rateLimitStore.get(key);
  const resetAt = current && current.resetAt > now ? current.resetAt : now + rateLimitWindowMs;
  const count = current && current.resetAt > now ? current.count + 1 : 1;
  rateLimitStore.set(key, { count, resetAt });
  return count <= rateLimitCaps[bucket]
    ? { allowed: true, resetAt }
    : { allowed: false, resetAt };
}

function pruneRateLimitStore(now = Date.now()) {
  if (rateLimitStore.size < 10_000) return;
  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetAt <= now) rateLimitStore.delete(key);
  }
}

function clientIdentityFromRequest(req: Request): string {
  const sessionId = typeof req.cookies?.multaiplayer_session === "string" ? req.cookies.multaiplayer_session : "";
  if (sessionId) return `session:${sessionId}`;
  return clientIdentityFromIncomingMessage(req);
}

function clientIdentityFromIncomingMessage(request: IncomingMessage): string {
  const cookies = parseCookieHeader(request.headers.cookie);
  const sessionId = cookies.get("multaiplayer_session");
  if (sessionId) return `session:${sessionId}`;
  const forwardedFor = request.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const ip = forwardedIp?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
  return `ip:${ip}`;
}

function getAuthSession(sessionId: unknown): AuthSession | null {
  if (typeof sessionId !== "string") return null;
  const session = authSessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    authSessions.delete(sessionId);
    scheduleStoreSave();
    return null;
  }
  return session;
}

function getAuthSessionFromRequest(request: IncomingMessage): AuthSession | undefined {
  const cookies = parseCookieHeader(request.headers.cookie);
  return getAuthSession(cookies.get("multaiplayer_session")) ?? undefined;
}

function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const item of (header ?? "").split(";")) {
    const [rawName, ...rawValue] = item.split("=");
    const name = rawName?.trim();
    if (!name) continue;
    cookies.set(name, decodeURIComponent(rawValue.join("=").trim()));
  }
  return cookies;
}

function allowRead(session: AuthSession | null, res: Response): boolean {
  if (!mutationsRequireAuth || session) return true;
  res.status(401).json({ error: "Sign in with GitHub before reading workspace state." });
  return false;
}

function allowMutation(session: AuthSession | null, res: Response): boolean {
  if (!mutationsRequireAuth || session) return true;
  res.status(401).json({ error: "Sign in with GitHub before changing workspace state." });
  return false;
}

function teamIdsForUser(userId: string): Set<string> {
  const visible = new Set<string>();
  for (const [teamId, members] of teamMembers.entries()) {
    if (members.has(userId)) visible.add(teamId);
  }
  return visible;
}

function isTeamMember(teamId: string, userId: string): boolean {
  return teamMembers.get(teamId)?.has(userId) ?? false;
}

function canAccessRoom(teamId: string, roomId: string, userId: string): boolean {
  return rooms.get(roomId)?.teamId === teamId && isTeamMember(teamId, userId);
}

function canJoinRoom(
  session: ClientSession,
  teamId: string,
  roomId: string,
  userId: string,
  inviteId?: string
): boolean {
  if (!mutationsRequireAuth) return true;
  if (!session.authSession || session.authSession.user.id !== userId) return false;
  if (canAccessRoom(teamId, roomId, userId)) return true;
  if (!inviteId || !isValidInviteForRoom(inviteId, teamId, roomId)) return false;
  addTeamMember(teamId, userId);
  return true;
}

function canSubscribeTeam(session: ClientSession, teamId: string, userId: string): boolean {
  if (!mutationsRequireAuth) return true;
  return Boolean(session.authSession && session.authSession.user.id === userId && isTeamMember(teamId, userId));
}

function canSubscribeWorkspace(session: ClientSession, userId: string): boolean {
  if (!mutationsRequireAuth) return true;
  return Boolean(session.authSession && session.authSession.user.id === userId);
}

function isValidInviteForRoom(inviteId: string, teamId: string, roomId: string): boolean {
  const invite = invites.get(inviteId);
  if (!invite || invite.teamId !== teamId || invite.roomId !== roomId) return false;
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    invites.delete(invite.id);
    scheduleStoreSave();
    return false;
  }
  return true;
}

function requesterFromRequest(body: unknown, sessionId: unknown): { id: string; name: string } {
  const session = getAuthSession(sessionId);
  if (session) {
    return {
      id: session.user.id,
      name: normalizeMetadataText(displayNameForUser(session.user), maxHostNameChars) ?? ""
    };
  }
  const requestBody = isRecord(body) ? body : {};
  return {
    id: normalizeOptionalMetadataText(requestBody.requesterUserId, maxUserIdChars) ?? "",
    name: normalizeOptionalMetadataText(requestBody.requesterName, maxHostNameChars) ?? ""
  };
}

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowedCorsOrigins.length > 0) return allowedCorsOrigins.includes(origin);
  return process.env.NODE_ENV !== "production";
}

function parseGitHubScopes(value: string | undefined): string[] {
  return parseListEnv(value ?? "read:user public_repo");
}

function loadRelayEnvFiles() {
  for (const path of relayEnvFileCandidates()) {
    if (!existsSync(path)) continue;
    const parsed = parseEnvFile(readFileSync(path, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] ??= value;
    }
  }
}

function relayEnvFileCandidates(): string[] {
  return Array.from(new Set([
    process.env.MULTAIPLAYER_RELAY_ENV_FILE ? resolve(process.env.MULTAIPLAYER_RELAY_ENV_FILE) : "",
    resolve(process.cwd(), "apps/relay/.env"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../..", ".env")
  ].filter(Boolean)));
}

function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    parsed[key] = normalizeEnvFileValue(rawValue);
  }
  return parsed;
}

function normalizeEnvFileValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "");
}

function parseAllowedOriginEnv(value: string | undefined): string[] {
  const origins = new Set<string>();
  for (const item of parseListEnv(value)) {
    const normalized = normalizeConfiguredOrigin(item);
    if (normalized) {
      origins.add(normalized);
    } else {
      console.warn(`Ignoring invalid MULTAIPLAYER_RELAY_ALLOWED_ORIGINS entry: ${item}`);
    }
  }
  return Array.from(origins);
}

function normalizeConfiguredOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!["", "/"].includes(parsed.pathname) || parsed.search || parsed.hash) return null;
    if (["http:", "https:"].includes(parsed.protocol)) return parsed.origin;
    if (!/^[a-z][a-z0-9+.-]*:$/i.test(parsed.protocol) || !parsed.hostname) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function parseListEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntegerEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function parseIntegerValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function maxCiphertextCharactersForBlob(maxBytes: number): number {
  return Math.ceil((maxBytes + 1024) * 4 / 3) + 64;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function displayNameForUser(user: AuthSession["user"]): string {
  return user.name?.trim() || user.login;
}

function isRoomHost(room: RoomRecord, requester: { id: string; name: string }): boolean {
  if (!requester.id && !requester.name) return false;
  if (room.hostStatus !== "active") return false;
  if (room.hostUserId) return room.hostUserId === requester.id;
  return room.host === requester.name;
}

function isApprovalPolicy(value: string): value is RoomRecord["approvalPolicy"] {
  return [
    "ask_every_turn",
    "auto_chat_only",
    "auto_browser_allowed_sites",
    "never_host"
  ].includes(value);
}

function isRoomMode(value: unknown): value is RoomRecord["mode"] {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["chat", "code", "workspace", "browser"].every((key) => typeof candidate[key] === "boolean");
}

function normalizeMetadataText(value: unknown, maxChars: number): string | null {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxChars) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function normalizeOptionalMetadataText(value: unknown, maxChars: number): string | null {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return normalizeMetadataText(text, maxChars);
}

function isJsonStringifiableWithin(value: unknown, maxChars: number): boolean {
  try {
    return JSON.stringify(value).length <= maxChars;
  } catch {
    return false;
  }
}

function normalizeRoomProjectPath(value: unknown): string | null {
  const projectPath = String(value ?? "").trim();
  if (!projectPath || projectPath.length > maxRoomProjectPathChars) return null;
  if (/[\u0000-\u001f\u007f]/.test(projectPath)) return null;
  return projectPath;
}

function normalizeCodexModel(value: unknown): string | null {
  const model = String(value ?? "").trim();
  if (!model || model.length > maxCodexModelChars) return null;
  if (codexModelOptions.some((option) => option.id === model)) return model;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)) return null;
  return model;
}

function normalizeBrowserAllowedOrigins(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const origins = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const raw = item.trim();
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol)) return null;
      if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
      origins.add(parsed.origin);
    } catch {
      return null;
    }
  }
  return Array.from(origins);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function deviceKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

function normalizeTeam(team: unknown): TeamRecord | null {
  if (!isRecord(team) || typeof team.id !== "string") return null;
  const name = normalizeMetadataText(team.name, maxTeamNameChars);
  if (!name) return null;
  const members = typeof team.members === "number" && Number.isSafeInteger(team.members) && team.members >= 0
    ? team.members
    : 0;
  return { id: team.id, name, members };
}

function normalizeDevice(device: unknown): DeviceRecord | null {
  if (!isRecord(device) || !isRecord(device.publicKeyJwk)) return null;
  const userId = normalizeMetadataText(device.userId, maxUserIdChars);
  const deviceId = normalizeMetadataText(device.deviceId, maxDeviceIdChars);
  const displayName = normalizeMetadataText(device.displayName, maxDisplayNameChars);
  const publicKeyFingerprint = normalizeMetadataText(device.publicKeyFingerprint, maxPublicKeyFingerprintChars);
  if (!userId || !deviceId || !displayName || !publicKeyFingerprint) return null;
  if (!isJsonStringifiableWithin(device.publicKeyJwk, maxPublicKeyJwkChars)) return null;
  if (typeof device.registeredAt !== "string" || typeof device.lastSeenAt !== "string") return null;
  return {
    userId,
    deviceId,
    displayName,
    publicKeyJwk: device.publicKeyJwk,
    publicKeyFingerprint,
    registeredAt: device.registeredAt,
    lastSeenAt: device.lastSeenAt
  };
}

function isExpiredInvite(invite: InviteRecord): boolean {
  return Boolean(invite.expiresAt && Date.parse(invite.expiresAt) < Date.now());
}

function isExpiredAttachmentBlob(blob: AttachmentBlobRecordType): boolean {
  return Boolean(blob.expiresAt && Date.parse(blob.expiresAt) < Date.now());
}

function pruneEncryptedBacklog(envelopes: RelayEnvelope[]): RelayEnvelope[] {
  const cutoffMs = Date.now() - encryptedBacklogRetentionDays * 24 * 60 * 60 * 1000;
  return envelopes
    .filter((envelope) => {
      const createdAtMs = Date.parse(envelope.createdAt);
      return Number.isFinite(createdAtMs) && createdAtMs >= cutoffMs && isRelayEnvelopeWithinLimits(envelope);
    })
    .slice(-encryptedBacklogLimit);
}

function pruneExpiredRelayState() {
  for (const [id, session] of authSessions.entries()) {
    if (session.expiresAt <= Date.now()) authSessions.delete(id);
  }
  for (const [id, invite] of invites.entries()) {
    if (isExpiredInvite(invite)) invites.delete(id);
  }
  for (const [id, blob] of attachmentBlobs.entries()) {
    if (isExpiredAttachmentBlob(blob)) attachmentBlobs.delete(id);
  }
  for (const [key, envelopes] of encryptedBacklog.entries()) {
    const pruned = pruneEncryptedBacklog(envelopes);
    if (pruned.length) {
      encryptedBacklog.set(key, pruned);
    } else {
      encryptedBacklog.delete(key);
    }
  }
}

function storedAuthSessions(): StoredAuthSession[] {
  if (!sessionPersistenceSecret) return [];
  const sessions: StoredAuthSession[] = [];
  for (const [sessionId, session] of authSessions.entries()) {
    if (session.expiresAt <= Date.now()) continue;
    const encryptedAccessToken = encryptSessionAccessToken(session.accessToken);
    if (!encryptedAccessToken) continue;
    sessions.push({
      sessionId,
      user: session.user,
      expiresAt: session.expiresAt,
      encryptedAccessToken
    });
  }
  return sessions;
}

function normalizeStoredAuthSession(stored: unknown): AuthSession | null {
  if (!isRecord(stored)) return null;
  if (
    typeof stored.sessionId !== "string" ||
    typeof stored.expiresAt !== "number" ||
    stored.expiresAt <= Date.now() ||
    !isRecord(stored.user) ||
    typeof stored.user.id !== "string" ||
    typeof stored.user.login !== "string"
  ) {
    return null;
  }

  const accessToken = decryptStoredAccessToken(stored);
  if (!accessToken) return null;
  return {
    accessToken,
    user: {
      id: stored.user.id,
      login: stored.user.login,
      name: typeof stored.user.name === "string" ? stored.user.name : undefined,
      avatarUrl: typeof stored.user.avatarUrl === "string" ? stored.user.avatarUrl : undefined
    },
    expiresAt: stored.expiresAt
  };
}

function encryptSessionAccessToken(accessToken: string): StoredAuthSession["encryptedAccessToken"] | null {
  if (!sessionPersistenceSecret) return null;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionPersistenceKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algorithm: "AES-GCM-256",
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64")
  };
}

function decryptStoredAccessToken(stored: Record<string, unknown>): string | null {
  if (!sessionPersistenceSecret || !isRecord(stored.encryptedAccessToken)) return null;
  const encrypted = stored.encryptedAccessToken;
  if (
    encrypted.algorithm !== "AES-GCM-256" ||
    typeof encrypted.nonce !== "string" ||
    typeof encrypted.ciphertext !== "string" ||
    typeof encrypted.tag !== "string"
  ) {
    return null;
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", sessionPersistenceKey(), Buffer.from(encrypted.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function sessionPersistenceKey(): Buffer {
  return createHash("sha256").update(sessionPersistenceSecret ?? "").digest();
}

function normalizeSessionPersistenceSecret(value: string | undefined): string | null {
  const secret = value?.trim();
  if (!secret) return null;
  if (secret.length < 32) {
    console.warn("MULTAIPLAYER_RELAY_SESSION_SECRET must be at least 32 characters; durable auth sessions are disabled.");
    return null;
  }
  return secret;
}

async function loadRelayStore() {
  try {
    const raw = await readFile(dataPath, "utf8");
    const stored = JSON.parse(raw) as StoredRelayState;
    if (stored.version !== 1) {
      console.warn(`Ignoring unsupported relay store version at ${dataPath}`);
      await quarantineRelayStore("unsupported-version");
      return;
    }
    for (const team of stored.teams ?? []) {
      const normalized = normalizeTeam(team);
      if (normalized) teams.set(normalized.id, normalized);
    }
    for (const room of stored.rooms ?? []) rooms.set(room.id, normalizeRoom(room));
    for (const invite of stored.invites ?? []) {
      if (!isExpiredInvite(invite)) invites.set(invite.id, invite);
    }
	    for (const device of stored.devices ?? []) {
	      const normalized = normalizeDevice(device);
	      if (normalized) devices.set(deviceKey(normalized.userId, normalized.deviceId), normalized);
	    }
	    for (const item of stored.teamMembers ?? []) {
	      if (!teams.has(item.teamId) || !Array.isArray(item.userIds)) continue;
	      const members = new Set(item.userIds.filter((userId) => typeof userId === "string" && userId.length > 0));
	      if (members.size === 0) continue;
	      teamMembers.set(item.teamId, members);
	      const team = teams.get(item.teamId);
	      if (team && team.members < members.size) teams.set(item.teamId, { ...team, members: members.size });
	    }
	    for (const blob of stored.attachmentBlobs ?? []) {
	      const parsed = AttachmentBlobRecord.safeParse(blob);
	      if (parsed.success && !isExpiredAttachmentBlob(parsed.data)) attachmentBlobs.set(parsed.data.id, parsed.data);
	    }
	    for (const storedSession of stored.authSessions ?? []) {
	      const normalized = normalizeStoredAuthSession(storedSession);
	      if (normalized) authSessions.set(storedSession.sessionId, normalized);
	    }
	    for (const item of stored.encryptedBacklog ?? []) {
      const pruned = pruneEncryptedBacklog(item.envelopes);
      if (pruned.length) encryptedBacklog.set(item.key, pruned);
    }
    console.log(`Loaded multAIplayer relay store from ${dataPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not load relay store at ${dataPath}:`, error);
      await quarantineRelayStore("unreadable");
    }
  }
}

async function quarantineRelayStore(reason: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dataPath}.corrupt-${reason}-${timestamp}`;
  try {
    await rename(dataPath, backupPath);
    console.warn(`Moved unreadable relay store to ${backupPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to move unreadable relay store at ${dataPath}:`, error);
    }
  }
}

function scheduleStoreSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveRelayStore().catch((error) => {
      console.error("Failed to save relay store:", error);
    });
  }, 100);
}

async function saveRelayStore() {
  pruneExpiredRelayState();
  const state: StoredRelayState = {
    version: 1,
    savedAt: new Date().toISOString(),
    teams: Array.from(teams.values()),
	    rooms: Array.from(rooms.values()),
	    invites: Array.from(invites.values()).filter((invite) => !isExpiredInvite(invite)),
	    devices: Array.from(devices.values()),
	    teamMembers: Array.from(teamMembers.entries()).map(([teamId, members]) => ({
	      teamId,
	      userIds: Array.from(members.values())
	    })),
	    authSessions: storedAuthSessions(),
	    attachmentBlobs: Array.from(attachmentBlobs.values()).filter((blob) => !isExpiredAttachmentBlob(blob)),
	    encryptedBacklog: Array.from(encryptedBacklog.entries())
      .map(([key, envelopes]) => ({
        key,
        envelopes: pruneEncryptedBacklog(envelopes)
      }))
      .filter((item) => item.envelopes.length > 0)
  };
  await mkdir(dirname(dataPath), { recursive: true });
  const tempPath = `${dataPath}.${process.pid}.${nanoid(8)}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, dataPath);
}

function seedWorkspace() {
  if (!seedDemoWorkspace) return;

  const core: TeamRecord = { id: "team-core", name: "Core Team", members: 4 };
  const labs: TeamRecord = { id: "team-labs", name: "Labs", members: 2 };
  if (!teams.has(core.id)) teams.set(core.id, core);
  if (!teams.has(labs.id)) teams.set(labs.id, labs);
  if (!teamMembers.has(core.id)) {
    teamMembers.set(core.id, new Set(["github:maddiedreese", "github:alex"]));
  }
  if (!teamMembers.has(labs.id)) {
    teamMembers.set(labs.id, new Set(["github:labs"]));
  }

  const seedRooms: RoomRecord[] = [
    {
      id: "room-desktop",
      teamId: core.id,
      name: "Desktop client",
      projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
      host: "Maddie",
      hostUserId: "github:maddiedreese",
      hostStatus: "active",
      approvalPolicy: "ask_every_turn",
      mode: { ...defaultRoomMode, browser: true },
      codexModel: defaultCodexModel,
      browserAllowedOrigins: defaultBrowserAllowedOrigins,
      unread: 0
    },
    {
      id: "room-relay",
      teamId: core.id,
      name: "Relay + E2EE",
      projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
      host: "Alex",
      hostUserId: "github:alex",
      hostStatus: "handoff",
      approvalPolicy: "auto_chat_only",
      mode: defaultRoomMode,
      codexModel: "gpt-5.4-mini",
      browserAllowedOrigins: defaultBrowserAllowedOrigins,
      unread: 2
    },
    {
      id: "room-github",
      teamId: labs.id,
      name: "GitHub flow",
      projectPath: "/Users/maddiedreese/Documents/MultAIplayer",
      host: "No host",
      hostUserId: undefined,
      hostStatus: "offline",
      approvalPolicy: "never_host",
      mode: defaultRoomMode,
      codexModel: "gpt-5.4-thinking",
      browserAllowedOrigins: defaultBrowserAllowedOrigins,
      unread: 0
    }
  ];
  for (const room of seedRooms) {
    if (!rooms.has(room.id)) rooms.set(room.id, room);
  }
  scheduleStoreSave();
}

function normalizeRoom(room: RoomRecord | (RoomRecord & { codexModel?: string })): RoomRecord {
  const name = normalizeMetadataText(room.name, maxRoomNameChars) ?? "Untitled room";
  const host = room.hostStatus === "offline"
    ? "No host"
    : normalizeMetadataText(room.host, maxHostNameChars) ?? "No host";
  const hostUserId = room.hostStatus === "offline"
    ? undefined
    : normalizeOptionalMetadataText(room.hostUserId, maxUserIdChars) || undefined;
  return {
    ...room,
    name,
    projectPath: normalizeRoomProjectPath(room.projectPath) ?? "/",
    host,
    hostUserId,
    codexModel: normalizeCodexModel(room.codexModel) ?? defaultCodexModel,
    browserAllowedOrigins: normalizeBrowserAllowedOrigins((room as { browserAllowedOrigins?: unknown }).browserAllowedOrigins)
      ?? defaultBrowserAllowedOrigins
  };
}

server.listen(port, () => {
  console.log(`multAIplayer relay listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveRelayStore()
      .catch((error) => console.error("Failed to save relay store before shutdown:", error))
      .finally(() => process.exit(0));
  });
}
