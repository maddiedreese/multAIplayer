import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createRelayAuthSessionManager, createRelayAuthSessionPersistence } from "./auth/session.js";
import {
  RelayEnvelope,
  isRecord,
  maxAccessTokenChars,
  maxAttachmentBlobIdChars,
  maxAttachmentBlobNameChars,
  maxAttachmentBlobTypeChars,
  maxAuthSessionIdChars,
  maxCodexModelChars,
  maxDeviceIdChars,
  maxDisplayNameChars,
  maxEnvelopeIdChars,
  maxEnvelopeNonceChars,
  maxGitHubDeviceCodeChars,
  maxHostNameChars,
  maxMediumTextChars,
  maxPublicKeyFingerprintChars,
  maxPublicKeyJwkChars,
  maxRoomIdChars,
  maxRoomNameChars,
  maxRoomProjectPathChars,
  maxShortTextChars,
  maxTeamIdChars,
  maxTeamNameChars,
  maxUrlChars,
  maxUserIdChars,
  type RoomRecord,
  type TeamMemberRecord,
  type TeamRecord,
  type TeamRole
} from "@multaiplayer/protocol";
import { createRelayAuthz } from "./authz.js";
import { loadRelayConfig } from "./config.js";
import { createRelayRequestGuards } from "./http/middleware.js";
import { createRelayOriginPolicy } from "./http/origin-policy.js";
import { registerRelayRoutes } from "./http/register-routes.js";
import { teamRecordForUser } from "./http/teams.js";
import { createRelayLifecycle } from "./lifecycle.js";
import {
  isAllowedEnvelopePayload as isAllowedEnvelopePayloadWithLimits,
  isApprovalDelegationPolicy,
  isApprovalPolicy,
  isJsonStringifiableWithin,
  isRoomMode,
  createRelayLimits,
  maxCiphertextCharactersForBlob,
  normalizeBrowserAllowedOrigins,
  normalizeCodexModel as normalizeCodexModelWithLimit,
  normalizeCodexReasoningEffort,
  normalizeCodexSpeed,
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
import { createRelayStore, type AuthSession, type ClientSession, type RoomKey } from "./state.js";
import { createRelayStoreCodec } from "./store-codec.js";
import { createRelayStorePersistenceCoordinator } from "./store-persistence.js";
import { registerRelayWebSocketConnection } from "./ws/connection.js";
import { createRelayFanout } from "./ws/fanout.js";
import { createRelayRoomSocketManager } from "./ws/rooms.js";
import { createRelayRuntimeControl } from "./runtime-control.js";

export async function createRelayApp() {
  const relayConfig = loadRelayConfig();
  const {
    nodeEnv,
    port,
    githubClientId,
    githubOAuthScopes,
    dataPath,
    storageBackend,
    legacyJsonImportPath,
    encryptedBacklogLimit,
    encryptedBacklogRetentionDays,
    inviteTtlDays,
    attachmentBlobTtlDays,
    attachmentBlobMaxBytes,
    attachmentBlobLiveQuotaBytes,
    attachmentBlobUploadBytesPerWindow,
    attachmentBlobUploadWindowMs,
    jsonBodyLimitBytes,
    encryptedEnvelopeMaxBytes,
    roomEpochEnvelopeLimit,
    sessionPersistenceSecret,
    debugEndpointsEnabled,
    allowedCorsOrigins,
    seedDemoWorkspace,
    mutationsRequireAuth,
    rateLimitsEnabled,
    trustProxyHeaders,
    structuredLogsEnabled,
    rateLimitWindowMs,
    rateLimitCaps,
    websocketConnectionCaps,
    shutdown: shutdownConfig
  } = relayConfig;
  const relayMetrics = createRelayMetrics();
  const relayPersistence = createRelayPersistence({ backend: storageBackend, dataPath, legacyJsonImportPath });
  const originPolicy = createRelayOriginPolicy({ nodeEnv, allowedCorsOrigins });
  const app = express();
  app.use(originPolicy.enforceAllowedOrigin);
  app.use(cors(originPolicy.corsOptions));
  app.use(cookieParser());
  app.use(requestLoggingMiddleware(structuredLogsEnabled));
  app.use(express.json({ limit: `${jsonBodyLimitBytes}b` }));

  const server = createServer(app);
  const wss = new WebSocketServer({
    server,
    path: "/rooms",
    maxPayload: encryptedEnvelopeMaxBytes * 2,
    verifyClient(info, done) {
      if (originPolicy.isAllowedOrigin(info.origin)) {
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
    invites,
    attachmentBlobs,
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
  const maxEncryptedAccessTokenChars = Math.ceil((maxAccessTokenChars * 4) / 3) + 1024;
  const relayLimits = createRelayLimits(encryptedEnvelopeMaxBytes, {
    maxDisplayNameChars,
    maxDeviceIdChars,
    maxEnvelopeIdChars,
    maxEnvelopeNonceChars,
    maxPublicKeyFingerprintChars,
    maxPublicKeyJwkChars,
    maxRoomProjectPathChars,
    maxUserIdChars
  });
  const { maxEnvelopeCiphertextChars } = relayLimits;
  const relayLifecycle = createRelayLifecycle({
    server,
    wss,
    drainMs: shutdownConfig.drainMs,
    graceMs: shutdownConfig.graceMs,
    closeStore: () => relayStorePersistence.closeRelayStore()
  });

  app.use((req, res, next) => {
    relayLifecycle.shutdownMiddleware(req.path, next, () =>
      res.status(503).json({
        error: "Relay is shutting down.",
        code: "relay_shutting_down"
      })
    );
  });

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
  const { storedAuthSessions, normalizeStoredAuthSession } = authSessionPersistence;
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
  const { isExpiredAttachmentBlob, pruneExpiredRelayState } = relayStoreCodec;
  const relayStorePersistence = createRelayStorePersistenceCoordinator({
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
  const { send, broadcast, broadcastRoomUpdated, broadcastWorkspaceUpdated, publishEnvelope, publishPresence } =
    createRelayFanout({
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
      saveEncryptedEnvelope: (roomKey, envelope, prunedEnvelopeIds) =>
        relayStorePersistence.saveEncryptedEnvelope(roomKey, envelope, prunedEnvelopeIds),
      saveRoomKeyTransition: (roomKey, envelope, prunedEnvelopeIds) =>
        relayStorePersistence.saveRoomKeyTransition(roomKey, envelope, prunedEnvelopeIds),
      roomEpochEnvelopeLimit,
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
  registerRelayRoutes({
    app,
    store: relayStore,
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
    maxUrlChars,
    debugEndpointsEnabled,
    invites,
    attachmentBlobs,
    pruneExpiredRelayState,
    parseIntegerValue,
    attachmentBlobMaxBytes,
    attachmentBlobLiveQuotaBytes,
    attachmentBlobUploadBytesPerWindow,
    attachmentBlobUploadWindowMs,
    attachmentBlobTtlDays,
    maxAttachmentBlobNameChars,
    maxAttachmentBlobTypeChars,
    allowRead,
    allowMutation,
    recordQuotaRejection: relayMetrics.recordQuotaRejection,
    recordUpload: relayMetrics.recordAttachmentBlobUpload,
    recordUploadRejection: relayMetrics.recordAttachmentBlobUploadRejection,
    maxCiphertextCharactersForBlob,
    isExpiredAttachmentBlob,
    inviteTtlDays,
    canAccessRoom,
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
    broadcastRoomUpdated,
    maxTeamNameChars,
    normalizeOptionalMetadataText,
    displayNameForUser,
    maxDeviceIdChars,
    maxPublicKeyFingerprintChars,
    maxPublicKeyJwkChars,
    dataPath,
    metrics: relayMetrics,
    sessions,
    opsAttachmentBlobs: relayStore.attachmentBlobs.values(),
    isReady: relayLifecycle.isReady,
    requesterFromRequest,
    isRoomHost,
    isApprovalPolicy,
    isApprovalDelegationPolicy,
    isRoomMode,
    normalizeRoomProjectPath,
    normalizeCodexModel,
    normalizeCodexReasoningEffort,
    normalizeCodexSpeed,
    normalizeBrowserAllowedOrigins,
    maxCodexModelChars,
    maxHostNameChars,
    maxRoomNameChars
  });
  registerRelayWebSocketConnection({
    transport: { wss, send, isReady: relayLifecycle.isReady },
    state: { store: relayStore, sessions, roomPresence },
    limits: relayLimits,
    authentication: { getAuthSessionFromRequest, clientIdentityFromIncomingMessage },
    rateLimiting: { consume: consumeRateLimit, connectionCaps: websocketConnectionCaps },
    metrics: {
      recordQuotaRejection: relayMetrics.recordQuotaRejection,
      recordRateLimitRejection: relayMetrics.recordRateLimitRejection,
      recordConnectionAttempt: relayMetrics.recordWebSocketConnectionAttempt,
      recordConnectionAccepted: relayMetrics.recordWebSocketConnectionAccepted,
      recordConnectionRejection: relayMetrics.recordWebSocketConnectionRejection
    },
    rooms: {
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
      leaveWorkspace
    },
    validation: { normalizeMetadataText, isJsonStringifiableWithin, isRecord }
  });

  await relayStorePersistence.loadRelayStore();
  seedWorkspace({
    store: relayStore,
    seedDemoWorkspace,
    scheduleStoreSave
  });

  function canPublishEnvelope(session: ClientSession, envelope: RelayEnvelope): boolean {
    const sessionMatches =
      session.teamId === envelope.teamId &&
      session.roomId === envelope.roomId &&
      session.userId === envelope.senderUserId &&
      session.deviceId === envelope.senderDeviceId;
    if (!sessionMatches) return false;
    if (envelope.kind !== "room.key") return true;
    const room = relayStore.getRoom(envelope.roomId);
    return room?.hostStatus === "active" && room.hostUserId === session.userId;
  }

  function isAllowedEnvelopePayload(envelope: RelayEnvelope): boolean {
    return isAllowedEnvelopePayloadWithLimits(envelope);
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
    const normallyPruned = pruneEncryptedBacklogWithLimits(envelopes, {
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
    return normallyPruned;
  }

  function scheduleStoreSave() {
    relayStorePersistence.scheduleStoreSave();
  }

  const runtime = createRelayRuntimeControl({
    server,
    port,
    flushStore: () => relayStorePersistence.flushRelayStore(),
    closeStore: () => relayStorePersistence.closeRelayStore(),
    closeServer: () => relayLifecycle.closeServer(),
    shutdown: () => relayLifecycle.shutdown()
  });

  return {
    app,
    server,
    wss,
    config: relayConfig,
    ...runtime
  };
}
