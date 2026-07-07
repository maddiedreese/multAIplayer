import cors, { type CorsOptions } from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  createRelayAuthSessionManager,
  createRelayAuthSessionPersistence
} from "./auth/session.js";
import {
  RelayEnvelope,
  RelayClientMessage,
  maxMediumTextChars,
  maxShortTextChars,
  maxUrlChars,
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
  isApprovalDelegationPolicy,
  isApprovalPolicy,
  isJsonStringifiableWithin,
  isRelayEnvelopeWithinLimits as isRelayEnvelopeWithinConfiguredLimits,
  isRecord,
  isRoomMode,
  maxCiphertextCharactersForBlob,
  normalizeBrowserAllowedOrigins,
  normalizeCodexModel as normalizeCodexModelWithLimit,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRelayId,
  normalizeRoomProjectPath as normalizeRoomProjectPathWithLimit,
  parseIntegerValue,
  pruneEncryptedBacklog as pruneEncryptedBacklogWithLimits
} from "./limits.js";
import { createRelayMetrics, requestLoggingMiddleware } from "./observability.js";
import { createRelayPersistence } from "./persistence.js";
import { seedWorkspace } from "./seed.js";
import { createRelayStore, type AuthSession, type ClientSession, type PresenceRecord, type RoomKey } from "./state.js";
import { createRelayStoreCodec } from "./store-codec.js";
import { createRelayStorePersistenceCoordinator, type RelayStorePersistenceCoordinator } from "./store-persistence.js";
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
let relayStorePersistence: RelayStorePersistenceCoordinator;

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
const relayStoreCodec = createRelayStoreCodec({
  store: relayStore,
  attachmentBlobMaxBytes,
  maxAttachmentBlobIdChars,
  maxAttachmentBlobNameChars,
  maxAttachmentBlobTypeChars,
  maxCodexModelChars,
  maxDeviceIdChars,
  maxDisplayNameChars,
  maxEnvelopeIdChars,
  maxEnvelopeNonceChars,
  maxHostNameChars,
  maxPublicKeyFingerprintChars,
  maxPublicKeyJwkChars,
  maxRoomIdChars,
  maxRoomNameChars,
  maxRoomProjectPathChars,
  maxTeamIdChars,
  maxTeamNameChars,
  maxUserIdChars,
  isAllowedEnvelopePayload,
  normalizeStoredAuthSession,
  pruneEncryptedBacklog,
  storedAuthSessions
});
const {
  isExpiredInvite,
  isExpiredAttachmentBlob,
  pruneExpiredRelayState
} = relayStoreCodec;
relayStorePersistence = createRelayStorePersistenceCoordinator({
  dataPath,
  persistence: relayPersistence,
  storeCodec: relayStoreCodec
});
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
  store: relayStore,
  roomSockets,
  teamSockets,
  workspaceSockets,
  sessions,
  roomPresence,
  metrics: relayMetrics,
  roomKey,
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
  store: relayStore,
  roomSockets,
  teamSockets,
  workspaceSockets,
  roomPresence,
  sessions,
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
  store: relayStore,
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
  store: relayStore,
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
  store: relayStore,
  inviteTtlDays,
  getAuthSession,
  allowMutation,
  canAccessRoom,
  scheduleStoreSave
});
registerTeamRoutes({
  app,
  store: relayStore,
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
  store: relayStore,
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
  store: relayStore,
  getAuthSession,
  allowMutation,
  isTeamMember,
  canAccessRoom,
  scheduleStoreSave,
  broadcastRoomUpdated,
  requesterFromRequest,
  isRoomHost,
  isApprovalPolicy,
  isApprovalDelegationPolicy,
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
  store: relayStore,
  sessions,
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
  hasTeam: (teamId) => relayStore.hasTeam(teamId),
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

await relayStorePersistence.loadRelayStore();
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
  const team = relayStore.getTeam(teamId);
  if (!team) return;
  const members = relayStore.getTeamMembers(teamId) ?? new Map<string, TeamMemberRecord>();
  if (members.has(userId)) return;
  members.set(userId, {
    teamId,
    userId,
    role,
    joinedAt: new Date().toISOString()
  });
  relayStore.setTeamMembers(teamId, members);
  const updated: TeamRecord = {
    ...team,
    members: members.size
  };
  relayStore.setTeam(updated);
  scheduleStoreSave();
  broadcastWorkspaceUpdated(updated);
}

function roomKey(teamId: string, roomId: string): RoomKey {
  return `${teamId}:${roomId}`;
}

function deviceKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
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

function normalizeRoomProjectPath(value: unknown): string | null {
  return normalizeRoomProjectPathWithLimit(value, maxRoomProjectPathChars);
}

function normalizeCodexModel(value: unknown): string | null {
  return normalizeCodexModelWithLimit(value, maxCodexModelChars);
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

function scheduleStoreSave() {
  relayStorePersistence.scheduleStoreSave();
}

export function listenRelayServer() {
  server.listen(port, () => {
    console.log(`multAIplayer relay listening on http://127.0.0.1:${port}`);
  });
  return server;
}

export async function flushRelayStore() {
  await relayStorePersistence.flushRelayStore();
}

export async function closeRelayStore() {
  await relayStorePersistence.closeRelayStore();
}

export function closeRelayServer() {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
