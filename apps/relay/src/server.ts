import cors, { type CorsOptions } from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  createRelayAuthSessionManager,
  createRelayAuthSessionPersistence,
  type StoredAuthSession
} from "./auth/session.js";
import {
  AttachmentBlobRecord,
  InviteRecord,
  RelayEnvelope,
  RelayClientMessage,
  defaultRoomMode,
  defaultCodexModel,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
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
import { registerAttachmentRoutes } from "./http/attachments.js";
import { registerDebugRoutes } from "./http/debug.js";
import { registerDeviceRoutes } from "./http/devices.js";
import { registerGitHubRoutes } from "./http/github.js";
import { registerInviteRoutes } from "./http/invites.js";
import { createRelayRequestGuards } from "./http/middleware.js";
import { registerOpsRoutes } from "./http/ops.js";
import { registerRoomRoutes } from "./http/rooms.js";
import { registerTeamRoutes, teamRecordForUser } from "./http/teams.js";
import {
  isAllowedEnvelopePayload as isAllowedEnvelopePayloadWithLimits,
  isApprovalPolicy,
  isJsonStringifiableWithin,
  isRelayEnvelopeWithinLimits as isRelayEnvelopeWithinConfiguredLimits,
  isRecord,
  isRoomMode,
  maxCiphertextCharactersForBlob,
  normalizeBrowserAllowedOrigins,
  normalizeCodexModel as normalizeCodexModelWithLimit,
  normalizeDevicePublicKeyJwk as normalizeDevicePublicKeyJwkWithLimit,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRelayId,
  normalizeRoomProjectPath as normalizeRoomProjectPathWithLimit,
  normalizeTeamRole,
  parseIntegerValue,
  pruneEncryptedBacklog as pruneEncryptedBacklogWithLimits
} from "./limits.js";
import { createRelayMetrics, requestLoggingMiddleware } from "./observability.js";
import { createRelayPersistence } from "./persistence.js";
import { seedWorkspace } from "./seed.js";
import { createRelayStore, type AuthSession, type ClientSession, type PresenceRecord, type RoomKey } from "./state.js";
import { registerRelayWebSocketConnection } from "./ws/connection.js";
import { createRelayFanout } from "./ws/fanout.js";
import { createRelayRoomSocketManager } from "./ws/rooms.js";

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
const authSessionPersistence = createRelayAuthSessionPersistence({
  authSessionMaxAgeMs,
  maxAccessTokenChars,
  maxAuthSessionIdChars,
  maxDisplayNameChars,
  maxEncryptedAccessTokenChars,
  maxEnvelopeNonceChars,
  maxRoomProjectPathChars,
  maxUserIdChars,
  sessionPersistenceSecret
});
const {
  storedAuthSessions,
  normalizeStoredAuthSession
} = authSessionPersistence;
const { rateLimitMiddleware, clientIdentityFromIncomingMessage, consumeRateLimit } = createRelayRequestGuards({
  rateLimitsEnabled,
  rateLimitWindowMs,
  rateLimitCaps,
  rateLimitStore,
  trustProxyHeaders,
  metrics: relayMetrics,
  normalizeSessionId: normalizeAuthSessionId
});
const {
  send,
  broadcast,
  broadcastRoomUpdated,
  broadcastWorkspaceUpdated,
  publishEnvelope,
  publishPresence
} = createRelayFanout({
  roomSockets,
  teamSockets,
  workspaceSockets,
  sessions,
  encryptedBacklog,
  roomPresence,
  devices,
  teamMembers,
  metrics: relayMetrics,
  roomKey,
  deviceKey,
  pruneEncryptedBacklog,
  addTeamMember,
  scheduleStoreSave,
  teamRecordForUser
});
const {
  joinRoom,
  subscribeTeam,
  subscribeWorkspace,
  isKnownRoom,
  canJoinRoom,
  canSubscribeTeam,
  canSubscribeWorkspace,
  leaveRoom,
  leaveTeams,
  leaveWorkspace,
  revokeTeamMemberSessions
} = createRelayRoomSocketManager({
  roomSockets,
  teamSockets,
  workspaceSockets,
  roomPresence,
  sessions,
  teams,
  rooms,
  invites,
  mutationsRequireAuth,
  roomKey,
  canAccessRoom,
  isTeamMember,
  addTeamMember,
  scheduleStoreSave,
  send,
  broadcast
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
registerDebugRoutes({
  app,
  debugEndpointsEnabled,
  encryptedBacklog,
  invites,
  attachmentBlobs,
  authSessions,
  authSessionMaxAgeMs,
  authCookieOptions,
  scheduleStoreSave,
  pruneExpiredRelayState,
  parseIntegerValue,
  normalizeMetadataText,
  maxUserIdChars,
  maxDisplayNameChars
});
registerAttachmentRoutes({
  app,
  teams,
  rooms,
  attachmentBlobs,
  attachmentBlobMaxBytes,
  attachmentBlobTtlDays,
  maxAttachmentBlobNameChars,
  maxAttachmentBlobTypeChars,
  maxEnvelopeNonceChars,
  getAuthSession,
  allowRead,
  allowMutation,
  canAccessRoom,
  scheduleStoreSave,
  normalizeMetadataText,
  maxCiphertextCharactersForBlob,
  isExpiredAttachmentBlob
});
registerInviteRoutes({
  app,
  teams,
  rooms,
  invites,
  inviteTtlDays,
  getAuthSession,
  allowMutation,
  canAccessRoom,
  scheduleStoreSave
});
registerTeamRoutes({
  app,
  teams,
  rooms,
  teamMembers,
  getAuthSession,
  allowRead,
  allowMutation,
  teamIdsForUser,
  isTeamMember,
  teamRoleRank,
  canSetTeamMemberRole,
  canRemoveTeamMember,
  transferTeamOwnership,
  addTeamMember,
  revokeTeamInvites,
  revokeTeamMemberSessions,
  broadcastWorkspaceUpdated,
  scheduleStoreSave,
  normalizeMetadataText,
  maxTeamNameChars
});
registerDeviceRoutes({
  app,
  devices,
  getAuthSession,
  allowMutation,
  scheduleStoreSave,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  displayNameForUser,
  maxDisplayNameChars,
  maxDeviceIdChars,
  maxPublicKeyFingerprintChars,
  maxPublicKeyJwkChars,
  maxUserIdChars
});
registerOpsRoutes({
  app,
  dataPath,
  metrics: relayMetrics,
  sessions
});
registerRoomRoutes({
  app,
  teams,
  rooms,
  getAuthSession,
  allowMutation,
  isTeamMember,
  canAccessRoom,
  scheduleStoreSave,
  broadcastRoomUpdated,
  requesterFromRequest,
  isRoomHost,
  isApprovalPolicy,
  isRoomMode,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRoomProjectPath,
  normalizeCodexModel,
  normalizeBrowserAllowedOrigins,
  displayNameForUser,
  maxCodexModelChars,
  maxHostNameChars,
  maxRoomNameChars,
  maxRoomProjectPathChars,
  maxUserIdChars
});
registerRelayWebSocketConnection({
  wss,
  sessions,
  encryptedBacklog,
  roomPresence,
  encryptedEnvelopeMaxBytes,
  maxDisplayNameChars,
  maxDeviceIdChars,
  maxEnvelopeCiphertextChars,
  maxEnvelopeIdChars,
  maxEnvelopeNonceChars,
  maxPublicKeyFingerprintChars,
  maxPublicKeyJwkChars,
  maxRoomProjectPathChars,
  maxUserIdChars,
  getAuthSessionFromRequest,
  clientIdentityFromIncomingMessage,
  consumeRateLimit,
  send,
  roomKey,
  isKnownRoom,
  canJoinRoom,
  joinRoom,
  canSubscribeTeam,
  subscribeTeam,
  hasTeam: (teamId) => teams.has(teamId),
  canSubscribeWorkspace,
  subscribeWorkspace,
  canPublishEnvelope,
  isAllowedEnvelopePayload,
  publishEnvelope,
  publishPresence,
  leaveRoom,
  leaveTeams,
  leaveWorkspace,
  normalizeMetadataText,
  isJsonStringifiableWithin,
  isRecord
});

await loadRelayStore();
seedWorkspace({
  store: relayStore,
  seedDemoWorkspace,
  scheduleStoreSave
});

function canPublishEnvelope(session: ClientSession, envelope: RelayEnvelope): boolean {
  return (
    session.teamId === envelope.teamId &&
    session.roomId === envelope.roomId &&
    session.userId === envelope.senderUserId &&
    session.deviceId === envelope.senderDeviceId
  );
}

function isAllowedEnvelopePayload(envelope: RelayEnvelope): boolean {
  return isAllowedEnvelopePayloadWithLimits(envelope);
}

function isRelayEnvelopeWithinLimits(envelope: RelayEnvelope): boolean {
  return isRelayEnvelopeWithinConfiguredLimits(envelope, {
    encryptedEnvelopeMaxBytes,
    maxEnvelopeCiphertextChars,
    maxDeviceIdChars,
    maxEnvelopeIdChars,
    maxEnvelopeNonceChars,
    maxPublicKeyJwkChars,
    maxUserIdChars
  });
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

function roomKey(teamId: string, roomId: string): RoomKey {
  return `${teamId}:${roomId}`;
}

function normalizeAuthSessionId(value: unknown): string {
  return normalizeRelayId(value, maxAuthSessionIdChars) ?? "";
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

function displayNameForUser(user: AuthSession["user"]): string {
  return user.name?.trim() || user.login;
}

function isRoomHost(room: RoomRecord, requester: { id: string; name: string }): boolean {
  if (!requester.id && !requester.name) return false;
  if (room.hostStatus !== "active") return false;
  if (room.hostUserId) return room.hostUserId === requester.id;
  return room.host === requester.name;
}

function normalizeDevicePublicKeyJwk(value: unknown): DevicePublicKeyJwkType | null {
  return normalizeDevicePublicKeyJwkWithLimit(value, maxPublicKeyJwkChars);
}

function normalizeRoomProjectPath(value: unknown): string | null {
  return normalizeRoomProjectPathWithLimit(value, maxRoomProjectPathChars);
}

function normalizeCodexModel(value: unknown): string | null {
  return normalizeCodexModelWithLimit(value, maxCodexModelChars);
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
  return pruneEncryptedBacklogWithLimits(envelopes, {
    encryptedBacklogLimit,
    encryptedBacklogRetentionDays,
    encryptedEnvelopeMaxBytes,
    maxEnvelopeCiphertextChars,
    maxDeviceIdChars,
    maxEnvelopeIdChars,
    maxEnvelopeNonceChars,
    maxPublicKeyJwkChars,
    maxUserIdChars
  });
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
	    authSessions: storedAuthSessions(authSessions),
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
