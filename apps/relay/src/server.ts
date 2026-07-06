import cors, { type CorsOptions } from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { nanoid } from "nanoid";
import { WebSocketServer, type WebSocket } from "ws";
import { createRelayAuthSessionManager } from "./auth/session.js";
import {
  AttachmentBlobRecord,
  CiphertextPayload,
  DevicePublicKeyJwk,
  InviteRecord,
  RelayEnvelope,
  RelayClientMessage,
  defaultRoomMode,
  defaultCodexModel,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  codexModelOptions,
  maxMediumTextChars,
  maxShortTextChars,
  maxUrlChars,
  type DevicePublicKeyJwk as DevicePublicKeyJwkType,
  type InviteRecord as InviteRecordType,
  type AttachmentBlobRecord as AttachmentBlobRecordType,
  type DeviceRecord,
  type RoomRecord,
  type TeamMemberRecord,
  type TeamRecord,
  type TeamRole,
  type RelayServerMessage
} from "@multaiplayer/protocol";
import { createRelayAuthz } from "./authz.js";
import { loadRelayConfig } from "./config.js";
import { registerGitHubRoutes } from "./http/github.js";
import { createRelayRequestGuards } from "./http/middleware.js";
import { createRelayMetrics, requestLoggingMiddleware } from "./observability.js";
import { createRelayPersistence } from "./persistence.js";
import { createRelayStore, type AuthSession, type ClientSession, type PresenceRecord, type RoomKey } from "./state.js";

const relayConfig = loadRelayConfig();
const {
  nodeEnv,
  port,
  githubClientId,
  githubOAuthScopes,
  dataPath,
  storageBackend,
  encryptedBacklogLimit,
  encryptedBacklogRetentionDays,
  inviteTtlDays,
  attachmentBlobTtlDays,
  attachmentBlobMaxBytes,
  jsonBodyLimitBytes,
  encryptedEnvelopeMaxBytes,
  sessionPersistenceSecret,
  debugEndpointsEnabled,
  allowedCorsOrigins,
  seedDemoWorkspace,
  mutationsRequireAuth,
  rateLimitsEnabled,
  trustProxyHeaders,
  structuredLogsEnabled,
  rateLimitWindowMs,
  rateLimitCaps
} = relayConfig;
const relayMetrics = createRelayMetrics();
const relayPersistence = createRelayPersistence({ backend: storageBackend, dataPath });
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
app.use(requestLoggingMiddleware(structuredLogsEnabled));
app.use(express.json({ limit: `${jsonBodyLimitBytes}b` }));

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

const relayStore = createRelayStore();
const {
  sessions,
  roomSockets,
  teamSockets,
  workspaceSockets,
  roomPresence,
  encryptedBacklog,
  authSessions,
  teams,
  rooms,
  invites,
  devices,
  attachmentBlobs,
  teamMembers,
  rateLimitStore
} = relayStore;
const relayAuthz = createRelayAuthz(relayStore);
const {
  teamIdsForUser,
  isTeamMember,
  teamRoleRank,
  canSetTeamMemberRole,
  canRemoveTeamMember,
  transferTeamOwnership,
  canAccessRoom
} = relayAuthz;
const maxRoomProjectPathChars = 2048;
const maxCodexModelChars = 80;
const maxTeamNameChars = 120;
const maxRoomNameChars = 160;
const maxTeamIdChars = 160;
const maxRoomIdChars = 160;
const maxDisplayNameChars = 120;
const maxUserIdChars = 160;
const maxDeviceIdChars = 160;
const maxHostNameChars = 120;
const maxPublicKeyFingerprintChars = 128;
const maxPublicKeyJwkChars = 4096;
const maxAuthSessionIdChars = 160;
const maxAccessTokenChars = 8192;
const maxEncryptedAccessTokenChars = Math.ceil(maxAccessTokenChars * 4 / 3) + 1024;
const maxGitHubDeviceCodeChars = 256;
const maxEnvelopeIdChars = 160;
const maxEnvelopeNonceChars = 512;
const maxEnvelopeCiphertextChars = Math.ceil(encryptedEnvelopeMaxBytes * 4 / 3) + 1024;
const maxAttachmentBlobIdChars = 160;
const maxAttachmentBlobNameChars = 512;
const maxAttachmentBlobTypeChars = 160;
let saveTimer: NodeJS.Timeout | null = null;

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
	  invites: InviteRecordType[];
	  devices?: DeviceRecord[];
	  teamMembers?: Array<{
	    teamId: string;
	    members?: Array<{
	      userId: string;
	      role?: string;
	      joinedAt?: string;
	    }>;
	    userIds?: string[];
	  }>;
	  authSessions?: StoredAuthSession[];
	  attachmentBlobs?: AttachmentBlobRecordType[];
	  encryptedBacklog: Array<{
	    key: RoomKey;
	    envelopes: RelayEnvelope[];
  }>;
}

interface NormalizedStoredAuthSession {
  sessionId: string;
  session: AuthSession;
}

const authSessionManager = createRelayAuthSessionManager({
  authSessions,
  mutationsRequireAuth,
  nodeEnv,
  normalizeSessionId: normalizeAuthSessionId,
  scheduleStoreSave
});
const {
  authSessionMaxAgeMs,
  authCookieOptions,
  getAuthSession,
  getAuthSessionFromRequest,
  allowRead,
  allowMutation
} = authSessionManager;
const { rateLimitMiddleware, clientIdentityFromIncomingMessage, consumeRateLimit } = createRelayRequestGuards({
  rateLimitsEnabled,
  rateLimitWindowMs,
  rateLimitCaps,
  rateLimitStore,
  trustProxyHeaders,
  metrics: relayMetrics,
  normalizeSessionId: normalizeAuthSessionId
});

app.use(rateLimitMiddleware);
registerGitHubRoutes({
  app,
  githubClientId,
  githubOAuthScopes,
  mutationsRequireAuth,
  allowedCorsOrigins,
  sessionPersistenceSecret,
  authSessions,
  authSessionMaxAgeMs,
  authCookieOptions,
  getAuthSession,
  scheduleStoreSave,
  normalizeMetadataText,
  maxGitHubDeviceCodeChars,
  maxUserIdChars,
  maxDisplayNameChars,
  maxRoomProjectPathChars,
  maxAccessTokenChars,
  maxShortTextChars,
  maxMediumTextChars,
  maxUrlChars
});

await loadRelayStore();
seedWorkspace();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "multaiplayer-relay" });
});

app.get("/readyz", (_req, res) => {
  res.json({ ok: true, dataPath });
});

app.get("/metrics", (_req, res) => {
  res.json(relayMetrics.snapshot(sessions.size));
});

app.get("/teams", (_req, res) => {
  const session = getAuthSession(_req.cookies?.multaiplayer_session);
  if (!allowRead(session, res)) return;
  const visibleTeamIds = session ? teamIdsForUser(session.user.id) : new Set(teams.keys());
  res.json({
    teams: Array.from(teams.values())
      .filter((team) => visibleTeamIds.has(team.id))
      .map((team) => teamRecordForUser(team, session?.user.id)),
    rooms: Array.from(rooms.values()).filter((room) => visibleTeamIds.has(room.teamId))
  });
});

app.get("/teams/:teamId/members", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowRead(session, res)) return;

  const teamId = String(req.params.teamId ?? "");
  if (!teams.has(teamId)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (session && !isTeamMember(teamId, session.user.id)) {
    res.status(403).json({ error: "Join this team before reading its member list." });
    return;
  }
  res.json({ members: listTeamMembers(teamId) });
});

app.patch("/teams/:teamId/members/:userId", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;

  const teamId = String(req.params.teamId ?? "");
  const userId = String(req.params.userId ?? "");
  const role = parseRequestedTeamRole(req.body?.role);
  if (!teams.has(teamId)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  if (!role || role === "owner") {
    res.status(400).json({ error: "role must be admin or member" });
    return;
  }
  const members = teamMembers.get(teamId);
  const target = members?.get(userId);
  if (!members || !target) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  const requesterRole = session ? members.get(session.user.id)?.role : "owner";
  if (!canSetTeamMemberRole(requesterRole, target.role, role)) {
    res.status(403).json({ error: "Only team owners can change admin roles." });
    return;
  }

  const updated: TeamMemberRecord = { ...target, role };
  members.set(userId, updated);
  scheduleStoreSave();
  res.json({ member: updated, members: listTeamMembers(teamId) });
});

app.post("/teams/:teamId/members/:userId/transfer-owner", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;

  const teamId = String(req.params.teamId ?? "");
  const userId = String(req.params.userId ?? "");
  if (!teams.has(teamId)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const members = teamMembers.get(teamId);
  const target = members?.get(userId);
  if (!members || !target) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  const requesterRole = session ? members.get(session.user.id)?.role : "owner";
  if (requesterRole !== "owner") {
    res.status(403).json({ error: "Only the current team owner can transfer ownership." });
    return;
  }
  if (session?.user.id && session.user.id === userId) {
    res.status(400).json({ error: "Choose a different team member before transferring ownership." });
    return;
  }

  const updatedMembers = transferTeamOwnership(members, userId);
  const team = teams.get(teamId);
  if (team) broadcastWorkspaceUpdated(team);
  scheduleStoreSave();
  res.json({ member: updatedMembers.get(userId), members: listTeamMembers(teamId) });
});

app.delete("/teams/:teamId/members/:userId", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;

  const teamId = String(req.params.teamId ?? "");
  const userId = String(req.params.userId ?? "");
  if (!teams.has(teamId)) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const members = teamMembers.get(teamId);
  const target = members?.get(userId);
  if (!members || !target) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  const requesterRole = session ? members.get(session.user.id)?.role : "owner";
  if (!canRemoveTeamMember(requesterRole, target.role)) {
    res.status(403).json({ error: "Only team owners can remove admins, and owners cannot be removed." });
    return;
  }

  members.delete(userId);
  const team = teams.get(teamId);
  if (team) {
    const updatedTeam = { ...team, members: members.size };
    teams.set(teamId, updatedTeam);
    revokeTeamInvites(teamId);
    revokeTeamMemberSessions(teamId, userId);
    broadcastWorkspaceUpdated(updatedTeam);
  }
  scheduleStoreSave();
  res.json({ members: listTeamMembers(teamId) });
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
  const publicKeyJwk = normalizeDevicePublicKeyJwk(req.body?.publicKeyJwk);
  const publicKeyFingerprint = normalizeMetadataText(req.body?.publicKeyFingerprint, maxPublicKeyFingerprintChars);
  if (!userId || !deviceId || !displayName) {
    res.status(400).json({ error: "userId, deviceId, and displayName are required" });
    return;
  }
  if (!publicKeyJwk || !publicKeyFingerprint) {
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
    addTeamMember(team.id, session.user.id, "owner");
  } else {
    scheduleStoreSave();
    broadcastWorkspaceUpdated(team);
  }
  res.status(201).json({ team: teamRecordForUser(teams.get(team.id) ?? team, session?.user.id) });
});

app.post("/rooms", (req, res) => {
  const session = getAuthSession(req.cookies?.multaiplayer_session);
  if (!allowMutation(session, res)) return;

  const teamId = String(req.body?.teamId ?? "");
  const name = normalizeMetadataText(req.body?.name, maxRoomNameChars);
  const projectPath = normalizeRoomProjectPath(req.body?.projectPath);
  const approvalPolicy = req.body?.approvalPolicy === undefined ? "ask_every_turn" : String(req.body.approvalPolicy);
  const codexModel = req.body?.codexModel === undefined ? defaultCodexModel : normalizeCodexModel(req.body.codexModel);
  const browserAllowedOrigins = req.body?.browserAllowedOrigins;
  const browserProfilePersistent = req.body?.browserProfilePersistent;
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
  if (!isApprovalPolicy(approvalPolicy)) {
    res.status(400).json({ error: "approvalPolicy is invalid" });
    return;
  }
  if (!codexModel) {
    res.status(400).json({ error: `codexModel must be a known model id or a model-like id up to ${maxCodexModelChars} characters` });
    return;
  }
  let normalizedBrowserAllowedOrigins = defaultBrowserAllowedOrigins;
  if (browserAllowedOrigins !== undefined) {
    const parsedBrowserAllowedOrigins = normalizeBrowserAllowedOrigins(browserAllowedOrigins);
    if (parsedBrowserAllowedOrigins === null) {
      res.status(400).json({ error: "browserAllowedOrigins must be up to 20 http(s) origins such as https://github.com" });
      return;
    }
    normalizedBrowserAllowedOrigins = parsedBrowserAllowedOrigins;
  }
  if (browserProfilePersistent !== undefined && typeof browserProfilePersistent !== "boolean") {
    res.status(400).json({ error: "browserProfilePersistent must be a boolean" });
    return;
  }
  const room: RoomRecord = {
    id: `room_${nanoid(10)}`,
    teamId,
    name,
    projectPath,
    host: "No host",
    hostStatus: "offline",
    approvalPolicy,
    mode: defaultRoomMode,
    codexModel,
    browserAllowedOrigins: normalizedBrowserAllowedOrigins,
    browserProfilePersistent: browserProfilePersistent ?? defaultBrowserProfilePersistent,
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
  const name = req.body?.name === undefined ? undefined : normalizeMetadataText(req.body.name, maxRoomNameChars);
  const approvalPolicy = req.body?.approvalPolicy === undefined ? undefined : String(req.body.approvalPolicy);
  const mode = req.body?.mode;
  const codexModel = req.body?.codexModel === undefined ? undefined : normalizeCodexModel(req.body.codexModel);
  const projectPath = req.body?.projectPath === undefined ? undefined : normalizeRoomProjectPath(req.body.projectPath);
  const browserAllowedOrigins = req.body?.browserAllowedOrigins;
  const browserProfilePersistent = req.body?.browserProfilePersistent;
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
  if (req.body?.name !== undefined && !name) {
    res.status(400).json({ error: `Room name is required and must be up to ${maxRoomNameChars} characters` });
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
  if (browserProfilePersistent !== undefined && typeof browserProfilePersistent !== "boolean") {
    res.status(400).json({ error: "browserProfilePersistent must be a boolean" });
    return;
  }

  const updated: RoomRecord = {
    ...room,
    name: name ?? room.name,
    projectPath: projectPath ?? room.projectPath,
    approvalPolicy: approvalPolicy ?? room.approvalPolicy,
    mode: mode ?? room.mode,
    codexModel: codexModel ?? room.codexModel,
    browserAllowedOrigins: normalizedBrowserAllowedOrigins ?? room.browserAllowedOrigins,
    browserProfilePersistent: browserProfilePersistent ?? room.browserProfilePersistent
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
  const userId = normalizeMetadataText(id, maxUserIdChars);
  const normalizedLogin = normalizeMetadataText(login, maxDisplayNameChars);
  const normalizedName = normalizeMetadataText(name, maxDisplayNameChars);
  if (!userId || !normalizedLogin || !normalizedName) {
    res.status(400).json({ error: "id, login, and name must be bounded strings without control characters" });
    return;
  }
  const sessionId = nanoid(32);
  const session: AuthSession = {
    accessToken: "debug-token",
    user: { id: userId, login: normalizedLogin, name: normalizedName },
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

  const invite: InviteRecordType = {
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

  const name = normalizeMetadataText(req.body?.name, maxAttachmentBlobNameChars);
  const requestedType = String(req.body?.type ?? "file").trim() || "file";
  const type = normalizeMetadataText(requestedType, maxAttachmentBlobTypeChars);
  const size = Number(req.body?.size);
  const payload = CiphertextPayload.safeParse(req.body?.payload);
  if (!name) {
    res.status(400).json({ error: "name must be a non-empty string up to 512 characters" });
    return;
  }
  if (!type) {
    res.status(400).json({ error: "type must be a non-empty string up to 160 characters without control characters" });
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
  if (payload.data.nonce.length > maxEnvelopeNonceChars) {
    res.status(413).json({ error: `Attachment blob nonce exceeds ${maxEnvelopeNonceChars} characters` });
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
      const rawMessage = JSON.parse(raw.toString());
      const preflightError = relayClientMessagePreflightError(rawMessage);
      if (preflightError) {
        send(socket, { type: "error", message: preflightError });
        return;
      }
      const parsed = RelayClientMessage.parse(rawMessage);
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

function relayClientMessagePreflightError(message: unknown): string | null {
  if (!isRecord(message) || typeof message.type !== "string") return null;
  if (message.type === "join" || message.type === "subscribe.team" || message.type === "subscribe.workspace") {
    if (
      typeof message.userId === "string" &&
      typeof message.deviceId === "string" &&
      !isBoundedSocketIdentity(message.userId, message.deviceId)
    ) {
      return "WebSocket user and device ids must be bounded strings without control characters.";
    }
    return null;
  }
  if (message.type === "publish" && isRecord(message.envelope)) {
    const envelope = message.envelope;
    if (
      typeof envelope.id === "string" &&
      typeof envelope.senderUserId === "string" &&
      typeof envelope.senderDeviceId === "string" &&
      isRecord(envelope.payload) &&
      typeof envelope.payload.nonce === "string" &&
      typeof envelope.payload.ciphertext === "string" &&
      (
        !normalizeMetadataText(envelope.id, maxEnvelopeIdChars) ||
        !normalizeMetadataText(envelope.senderUserId, maxUserIdChars) ||
        !normalizeMetadataText(envelope.senderDeviceId, maxDeviceIdChars) ||
        !normalizeMetadataText(envelope.payload.nonce, maxEnvelopeNonceChars) ||
        !envelope.payload.ciphertext ||
        envelope.payload.ciphertext.length > maxEnvelopeCiphertextChars ||
        Buffer.byteLength(JSON.stringify(envelope), "utf8") > encryptedEnvelopeMaxBytes
      )
    ) {
      return `Encrypted room envelope exceeds relay limits (${encryptedEnvelopeMaxBytes} bytes max).`;
    }
  }
  if (message.type === "presence") {
    if (
      typeof message.displayName === "string" &&
      !normalizeMetadataText(message.displayName, maxDisplayNameChars)
    ) {
      return "Presence display name, avatar URL, and fingerprint must be bounded strings without control characters.";
    }
    if (
      message.avatarUrl !== undefined &&
      typeof message.avatarUrl === "string" &&
      !normalizeMetadataText(message.avatarUrl, maxRoomProjectPathChars)
    ) {
      return "Presence display name, avatar URL, and fingerprint must be bounded strings without control characters.";
    }
    if (
      message.publicKeyFingerprint !== undefined &&
      typeof message.publicKeyFingerprint === "string" &&
      !normalizeMetadataText(message.publicKeyFingerprint, maxPublicKeyFingerprintChars)
    ) {
      return "Presence display name, avatar URL, and fingerprint must be bounded strings without control characters.";
    }
  }
  return null;
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

function revokeTeamMemberSessions(teamId: string, userId: string) {
  for (const session of Array.from(sessions.values())) {
    if (session.authSession?.user.id !== userId && session.userId !== userId) continue;

    const joinedRemovedTeam = session.teamId === teamId;
    const subscribedRemovedTeam = session.subscribedTeamIds.has(teamId);
    const workspaceSubscribed = session.workspaceSubscribed;
    if (!joinedRemovedTeam && !subscribedRemovedTeam && !workspaceSubscribed) continue;

    send(session.socket, { type: "error", message: "Your team membership was removed. Rejoin with a fresh invite before continuing." });
    leaveRoom(session);
    leaveTeams(session);
    leaveWorkspace(session);
    session.socket.close(1008, "Team membership removed");
  }
}

function revokeTeamInvites(teamId: string) {
  let revoked = false;
  for (const [inviteId, invite] of invites.entries()) {
    if (invite.teamId === teamId) {
      invites.delete(inviteId);
      revoked = true;
    }
  }
  if (revoked) scheduleStoreSave();
}

function publishEnvelope(envelope: RelayEnvelope) {
  const key = roomKey(envelope.teamId, envelope.roomId);
  const backlog = encryptedBacklog.get(key) ?? [];
  if (backlog.some((existing) => existing.id === envelope.id)) return;
  backlog.push(envelope);
  encryptedBacklog.set(key, pruneEncryptedBacklog(backlog));
  relayMetrics.recordEnvelopePublished();
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

function addTeamMember(teamId: string, userId: string, role: TeamRole = "member") {
  if (!userId) return;
  const team = teams.get(teamId);
  if (!team) return;
  const members = teamMembers.get(teamId) ?? new Map<string, TeamMemberRecord>();
  if (members.has(userId)) return;
  members.set(userId, {
    teamId,
    userId,
    role,
    joinedAt: new Date().toISOString()
  });
  teamMembers.set(teamId, members);
  const updated: TeamRecord = {
    ...team,
    members: members.size
  };
  teams.set(teamId, updated);
  scheduleStoreSave();
  broadcastWorkspaceUpdated(updated);
}

function listTeamMembers(teamId: string): TeamMemberRecord[] {
  return Array.from(teamMembers.get(teamId)?.values() ?? [])
    .sort((a, b) => teamRoleRank(a.role) - teamRoleRank(b.role) || a.userId.localeCompare(b.userId));
}

function teamRecordForUser(team: TeamRecord, userId?: string): TeamRecord {
  const role = userId ? teamMembers.get(team.id)?.get(userId)?.role : undefined;
  return role ? { ...team, role } : team;
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
  for (const socket of workspaceSockets) {
    const session = sessions.get(socket);
    send(socket, { type: "team.updated", team: teamRecordForUser(team, session?.authSession?.user.id ?? session?.userId) });
  }
}

function send(socket: WebSocket, message: RelayServerMessage) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function roomKey(teamId: string, roomId: string): RoomKey {
  return `${teamId}:${roomId}`;
}

function normalizeAuthSessionId(value: unknown): string {
  return normalizeRelayId(value, maxAuthSessionIdChars) ?? "";
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
  return nodeEnv !== "production";
}

function parseIntegerValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function maxCiphertextCharactersForBlob(maxBytes: number): number {
  return Math.ceil((maxBytes + 1024) * 4 / 3) + 64;
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

function normalizeRelayId(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > maxChars) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
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

function normalizeDevicePublicKeyJwk(value: unknown): DevicePublicKeyJwkType | null {
  if (!isJsonStringifiableWithin(value, maxPublicKeyJwkChars)) return null;
  const parsed = DevicePublicKeyJwk.safeParse(value);
  return parsed.success ? parsed.data : null;
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

function normalizeTeamRole(value: unknown): TeamRole {
  return value === "owner" || value === "admin" || value === "member" ? value : "member";
}

function parseRequestedTeamRole(value: unknown): TeamRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
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
  if (!isRecord(team)) return null;
  const id = normalizeRelayId(team.id, maxTeamIdChars);
  const name = normalizeMetadataText(team.name, maxTeamNameChars);
  if (!id || !name) return null;
  const members = typeof team.members === "number" && Number.isSafeInteger(team.members) && team.members >= 0
    ? team.members
    : 0;
  return { id, name, members };
}

function normalizeDevice(device: unknown): DeviceRecord | null {
  if (!isRecord(device)) return null;
  const publicKeyJwk = normalizeDevicePublicKeyJwk(device.publicKeyJwk);
  const userId = normalizeMetadataText(device.userId, maxUserIdChars);
  const deviceId = normalizeMetadataText(device.deviceId, maxDeviceIdChars);
  const displayName = normalizeMetadataText(device.displayName, maxDisplayNameChars);
  const publicKeyFingerprint = normalizeMetadataText(device.publicKeyFingerprint, maxPublicKeyFingerprintChars);
  if (!userId || !deviceId || !displayName || !publicKeyFingerprint || !publicKeyJwk) return null;
  if (typeof device.registeredAt !== "string" || typeof device.lastSeenAt !== "string") return null;
  return {
    userId,
    deviceId,
    displayName,
    publicKeyJwk,
    publicKeyFingerprint,
    registeredAt: device.registeredAt,
    lastSeenAt: device.lastSeenAt
  };
}

function normalizeInvite(invite: unknown): InviteRecordType | null {
  const parsed = InviteRecord.safeParse(invite);
  if (!parsed.success) return null;
  const id = normalizeRelayId(parsed.data.id, maxEnvelopeIdChars);
  if (!id) return null;
  if (!teams.has(parsed.data.teamId)) return null;
  if (!rooms.has(parsed.data.roomId) || rooms.get(parsed.data.roomId)?.teamId !== parsed.data.teamId) return null;
  if (Number.isNaN(Date.parse(parsed.data.createdAt))) return null;
  if (parsed.data.expiresAt && Number.isNaN(Date.parse(parsed.data.expiresAt))) return null;
  return { ...parsed.data, id };
}

function normalizeAttachmentBlob(blob: unknown): AttachmentBlobRecordType | null {
  const parsed = AttachmentBlobRecord.safeParse(blob);
  if (!parsed.success) return null;
  const id = normalizeRelayId(parsed.data.id, maxAttachmentBlobIdChars);
  const name = normalizeMetadataText(parsed.data.name, maxAttachmentBlobNameChars);
  const type = normalizeMetadataText(parsed.data.type, maxAttachmentBlobTypeChars);
  if (!id || !name || !type) return null;
  if (!teams.has(parsed.data.teamId)) return null;
  if (!rooms.has(parsed.data.roomId) || rooms.get(parsed.data.roomId)?.teamId !== parsed.data.teamId) return null;
  if (parsed.data.size > attachmentBlobMaxBytes) return null;
  if (parsed.data.payload.nonce.length > maxEnvelopeNonceChars) return null;
  if (parsed.data.payload.ciphertext.length > maxCiphertextCharactersForBlob(attachmentBlobMaxBytes)) return null;
  if (Number.isNaN(Date.parse(parsed.data.createdAt))) return null;
  if (parsed.data.expiresAt && Number.isNaN(Date.parse(parsed.data.expiresAt))) return null;
  return { ...parsed.data, id, name, type };
}

function isExpiredInvite(invite: InviteRecordType): boolean {
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

function normalizeStoredBacklog(item: unknown): { key: RoomKey; envelopes: RelayEnvelope[] } | null {
  if (!isRecord(item) || typeof item.key !== "string" || !Array.isArray(item.envelopes)) return null;
  const [teamId, roomId, extra] = item.key.split(":");
  if (extra !== undefined || !teamId || !roomId || !isKnownRoom(teamId, roomId)) return null;

  const envelopes: RelayEnvelope[] = [];
  for (const candidate of item.envelopes) {
    const parsed = RelayEnvelope.safeParse(candidate);
    if (!parsed.success) continue;
    if (parsed.data.teamId !== teamId || parsed.data.roomId !== roomId) continue;
    if (!isAllowedEnvelopePayload(parsed.data)) continue;
    envelopes.push(parsed.data);
  }

  const pruned = pruneEncryptedBacklog(envelopes);
  return pruned.length ? { key: roomKey(teamId, roomId), envelopes: pruned } : null;
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

function normalizeStoredAuthSession(stored: unknown): NormalizedStoredAuthSession | null {
  if (!isRecord(stored)) return null;
  const sessionId = normalizeRelayId(stored.sessionId, maxAuthSessionIdChars);
  const user = isRecord(stored.user) ? stored.user : null;
  const userId = normalizeMetadataText(user?.id, maxUserIdChars);
  const login = normalizeMetadataText(user?.login, maxDisplayNameChars);
  const name = user?.name === undefined ? undefined : normalizeMetadataText(user.name, maxDisplayNameChars);
  const avatarUrl = user?.avatarUrl === undefined ? undefined : normalizeMetadataText(user.avatarUrl, maxRoomProjectPathChars);
  if (
    !sessionId ||
    typeof stored.expiresAt !== "number" ||
    !Number.isSafeInteger(stored.expiresAt) ||
    stored.expiresAt <= Date.now() ||
    stored.expiresAt > Date.now() + authSessionMaxAgeMs ||
    !userId ||
    !login ||
    (user?.name !== undefined && !name) ||
    (user?.avatarUrl !== undefined && !avatarUrl)
  ) {
    return null;
  }

  const accessToken = decryptStoredAccessToken(stored);
  if (!accessToken || accessToken.length > maxAccessTokenChars) return null;
  return {
    sessionId,
    session: {
      accessToken,
      user: {
        id: userId,
        login,
        name: name ?? undefined,
        avatarUrl: avatarUrl ?? undefined
      },
      expiresAt: stored.expiresAt
    }
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
    typeof encrypted.tag !== "string" ||
    encrypted.nonce.length > maxEnvelopeNonceChars ||
    encrypted.ciphertext.length > maxEncryptedAccessTokenChars ||
    encrypted.tag.length > maxEnvelopeNonceChars
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
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(sessionPersistenceSecret ?? "", "utf8"),
    "multaiplayer-relay-session-v1",
    "github-session-access-token",
    32
  ));
}

async function loadRelayStore() {
  try {
    const stored = await relayPersistence.load();
    if (stored === null) return;
    if (!isRecord(stored) || stored.version !== 1) {
      console.warn(`Ignoring unsupported relay store version at ${dataPath}`);
      await relayPersistence.quarantine("unsupported-version");
      return;
    }
    for (const team of storedArray(stored.teams)) {
      const normalized = normalizeTeam(team);
      if (normalized) teams.set(normalized.id, normalized);
    }
    for (const room of storedArray(stored.rooms)) {
      const normalized = normalizeRoom(room);
      if (normalized) rooms.set(normalized.id, normalized);
    }
    for (const invite of storedArray(stored.invites)) {
      const normalized = normalizeInvite(invite);
      if (normalized && !isExpiredInvite(normalized)) invites.set(normalized.id, normalized);
    }
    for (const device of storedArray(stored.devices)) {
      const normalized = normalizeDevice(device);
      if (normalized) devices.set(deviceKey(normalized.userId, normalized.deviceId), normalized);
    }
    for (const item of storedArray(stored.teamMembers)) {
      if (!isRecord(item)) continue;
      const teamId = normalizeRelayId(item.teamId, maxTeamIdChars);
      if (!teamId || !teams.has(teamId)) continue;
      const members = new Map<string, TeamMemberRecord>();
      for (const member of storedArray(item.members)) {
        if (!isRecord(member)) continue;
        const userId = normalizeMetadataText(member.userId, maxUserIdChars);
        if (!userId) continue;
        members.set(userId, {
          teamId,
          userId,
          role: normalizeTeamRole(member.role),
          joinedAt: typeof member.joinedAt === "string" && !Number.isNaN(Date.parse(member.joinedAt))
            ? member.joinedAt
            : new Date().toISOString()
        });
      }
      for (const userId of storedArray(item.userIds)) {
        const normalizedUserId = normalizeMetadataText(userId, maxUserIdChars);
        if (normalizedUserId && !members.has(normalizedUserId)) {
          members.set(normalizedUserId, {
            teamId,
            userId: normalizedUserId,
            role: "member",
            joinedAt: new Date().toISOString()
          });
        }
      }
      if (members.size === 0) continue;
      teamMembers.set(teamId, members);
      const team = teams.get(teamId);
      if (team && team.members < members.size) teams.set(teamId, { ...team, members: members.size });
    }
    for (const blob of storedArray(stored.attachmentBlobs)) {
      const normalized = normalizeAttachmentBlob(blob);
      if (normalized && !isExpiredAttachmentBlob(normalized)) attachmentBlobs.set(normalized.id, normalized);
    }
    for (const storedSession of storedArray(stored.authSessions)) {
      const normalized = normalizeStoredAuthSession(storedSession);
      if (normalized) authSessions.set(normalized.sessionId, normalized.session);
    }
    for (const item of storedArray(stored.encryptedBacklog)) {
      const normalized = normalizeStoredBacklog(item);
      if (normalized) encryptedBacklog.set(normalized.key, normalized.envelopes);
    }
    console.log(`Loaded multAIplayer relay store from ${dataPath}`);
  } catch (error) {
    console.warn(`Could not load relay store at ${dataPath}:`, error);
    await relayPersistence.quarantine("unreadable");
  }
}

function storedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
	      members: Array.from(members.values()),
	      userIds: Array.from(members.keys())
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
  await relayPersistence.save(state);
}

function seedWorkspace() {
  if (!seedDemoWorkspace) return;

  const core: TeamRecord = { id: "team-core", name: "Core Team", members: 4 };
  const labs: TeamRecord = { id: "team-labs", name: "Labs", members: 2 };
  if (!teams.has(core.id)) teams.set(core.id, core);
  if (!teams.has(labs.id)) teams.set(labs.id, labs);
  if (!teamMembers.has(core.id)) {
    teamMembers.set(core.id, new Map([
      ["github:maddiedreese", seedTeamMember(core.id, "github:maddiedreese", "owner")],
      ["github:alex", seedTeamMember(core.id, "github:alex", "admin")],
      ["github:tester", seedTeamMember(core.id, "github:tester", "member")],
      ["github:design", seedTeamMember(core.id, "github:design", "member")]
    ]));
  }
  if (!teamMembers.has(labs.id)) {
    teamMembers.set(labs.id, new Map([
      ["github:labs", seedTeamMember(labs.id, "github:labs", "owner")],
      ["github:research", seedTeamMember(labs.id, "github:research", "member")]
    ]));
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
      browserProfilePersistent: defaultBrowserProfilePersistent,
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
      browserProfilePersistent: defaultBrowserProfilePersistent,
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
      browserProfilePersistent: defaultBrowserProfilePersistent,
      unread: 0
    }
  ];
  for (const room of seedRooms) {
    if (!rooms.has(room.id)) rooms.set(room.id, room);
  }
  scheduleStoreSave();
}

function seedTeamMember(teamId: string, userId: string, role: TeamRole): TeamMemberRecord {
  return {
    teamId,
    userId,
    role,
    joinedAt: "2026-07-04T00:00:00.000Z"
  };
}

function normalizeRoom(room: unknown): RoomRecord | null {
  if (!isRecord(room)) return null;
  const id = normalizeRelayId(room.id, maxRoomIdChars);
  const teamId = normalizeRelayId(room.teamId, maxTeamIdChars);
  if (!id || !teamId || !teams.has(teamId)) return null;
  const hostStatus = room.hostStatus === "active" || room.hostStatus === "handoff" || room.hostStatus === "offline"
    ? room.hostStatus
    : "offline";
  const name = normalizeMetadataText(room.name, maxRoomNameChars) ?? "Untitled room";
  const host = hostStatus === "offline"
    ? "No host"
    : normalizeMetadataText(room.host, maxHostNameChars) ?? "No host";
  const hostUserId = hostStatus === "offline"
    ? undefined
    : normalizeOptionalMetadataText(room.hostUserId, maxUserIdChars) || undefined;
  const approvalPolicy = typeof room.approvalPolicy === "string" && isApprovalPolicy(room.approvalPolicy)
    ? room.approvalPolicy
    : "ask_every_turn";
  const mode = isRoomMode(room.mode) ? room.mode : defaultRoomMode;
  const unread = typeof room.unread === "number" && Number.isSafeInteger(room.unread) && room.unread >= 0
    ? room.unread
    : 0;
  return {
    id,
    teamId,
    name,
    projectPath: normalizeRoomProjectPath(room.projectPath) ?? "/",
    host,
    hostUserId,
    hostStatus,
    approvalPolicy,
    mode,
    codexModel: normalizeCodexModel(room.codexModel) ?? defaultCodexModel,
    browserAllowedOrigins: normalizeBrowserAllowedOrigins((room as { browserAllowedOrigins?: unknown }).browserAllowedOrigins)
      ?? defaultBrowserAllowedOrigins,
    browserProfilePersistent: typeof (room as { browserProfilePersistent?: unknown }).browserProfilePersistent === "boolean"
      ? (room as { browserProfilePersistent: boolean }).browserProfilePersistent
      : defaultBrowserProfilePersistent,
    unread
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
