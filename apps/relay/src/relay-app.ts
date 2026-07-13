import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createRelayAuthSessionManager, createRelayAuthSessionPersistence } from "./auth/session.js";
import {
  MlsRelayMessage,
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
  pruneMlsBacklog as pruneMlsBacklogWithLimits
} from "./limits.js";
import { createRelayMetrics, requestLoggingMiddleware } from "./observability.js";
import { createRelayPersistence } from "./persistence.js";
import { createRelayStore, type AuthSession, type ClientSession, type RoomKey } from "./state.js";
import { createRelayStoreCodec } from "./store-codec.js";
import { createRelayStorePersistenceCoordinator } from "./store-persistence.js";
import { registerRelayWebSocketConnection } from "./ws/connection.js";
import { createRelayFanout } from "./ws/fanout.js";
import { createRelayRoomSocketManager } from "./ws/rooms.js";
import { createRelayRuntimeControl } from "./runtime-control.js";
import { hasDeviceSession } from "./http/device-auth.js";
import {
  executableKeyPackageValidator,
  rejectUnvalidatedKeyPackages,
  type KeyPackageValidator
} from "./mls/key-package-validator.js";

export async function createRelayApp(options: { keyPackageValidator?: KeyPackageValidator } = {}) {
  const relayConfig = loadRelayConfig();
  const keyPackageValidator = options.keyPackageValidator ?? configuredKeyPackageValidator(relayConfig.nodeEnv);
  const {
    nodeEnv,
    port,
    githubClientId,
    githubOAuthScopes,
    dataPath,
    storageBackend,
    legacyJsonImportPath,
    mlsBacklogLimit,
    mlsBacklogRetentionDays,
    inviteTtlDays,
    attachmentBlobTtlDays,
    attachmentBlobMaxBytes,
    attachmentBlobLiveQuotaBytes,
    attachmentBlobUploadBytesPerWindow,
    attachmentBlobUploadWindowMs,
    jsonBodyLimitBytes,
    mlsMessageMaxBytes,
    sessionPersistenceSecret,
    debugEndpointsEnabled,
    allowedCorsOrigins,
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
    maxPayload: mlsMessageMaxBytes * 2,
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
  const relayLimits = createRelayLimits(mlsMessageMaxBytes, {
    maxDisplayNameChars,
    maxDeviceIdChars,
    maxEnvelopeIdChars,
    maxPublicKeyFingerprintChars,
    maxPublicKeyJwkChars,
    maxRoomProjectPathChars,
    maxUserIdChars
  });
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
    maxHostNameChars,
    maxMlsMessageChars: relayLimits.maxMlsMessageChars,
    maxPublicKeyFingerprintChars,
    maxPublicKeyJwkChars,
    maxRoomIdChars,
    maxRoomNameChars,
    maxRoomProjectPathChars,
    maxTeamIdChars,
    maxTeamNameChars,
    maxUserIdChars,
    normalizeStoredAuthSession,
    pruneMlsBacklog,
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
  const { send, broadcast, broadcastRoomUpdated, broadcastWorkspaceUpdated, publishMlsMessage, publishPresence } =
    createRelayFanout({
      store: relayStore,
      roomSockets,
      teamSockets,
      workspaceSockets,
      sessions,
      roomPresence,
      metrics: relayMetrics,
      roomKey,
      pruneMlsBacklog,
      addTeamMember,
      saveMlsMessage: (roomKey, message, prunedIds) =>
        relayStorePersistence.saveMlsMessage(roomKey, message, prunedIds),
      saveMlsCommit: (roomKey, message, prunedIds) => relayStorePersistence.saveMlsCommit(roomKey, message, prunedIds),
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
    deviceAuthRequired: mutationsRequireAuth,
    allowedCorsOrigins,
    sessionPersistenceSecret,
    authSessions,
    authSessionMaxAgeMs,
    authCookieOptions,
    getAuthSession,
    scheduleStoreSave,
    saveRelayStore: () => relayStorePersistence.saveRelayStore(),
    notifyInviteRequested: (inviteId: string, requestId: string) => {
      const invite = relayStore.getInvite(inviteId);
      const room = invite ? relayStore.getRoom(invite.roomId) : undefined;
      if (!room?.hostUserId || !room.activeHostDeviceId) return;
      for (const session of relayStore.sessions.values()) {
        if (
          session.roomId === room.id &&
          session.userId === room.hostUserId &&
          session.deviceId === room.activeHostDeviceId
        ) {
          send(session.socket, { type: "invite.requested", inviteId, requestId });
        }
      }
    },
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
    maxEnvelopeIdChars,
    maxPublicKeyFingerprintChars,
    maxPublicKeyJwkChars,
    dataPath,
    metrics: relayMetrics,
    validator: keyPackageValidator,
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
      hasDeviceSession: (token, userId, deviceId) =>
        !mutationsRequireAuth ||
        (debugEndpointsEnabled && token === "debug-device-session-token-000000") ||
        hasDeviceSession(relayStore, token, userId, deviceId),
      joinRoom,
      canSubscribeTeam,
      subscribeTeam,
      hasTeam: (teamId) => relayStore.hasTeam(teamId),
      canSubscribeWorkspace,
      subscribeWorkspace,
      canPublishMlsMessage,
      publishMlsMessage,
      publishPresence,
      leaveRoom,
      leaveTeams,
      leaveWorkspace
    },
    validation: { normalizeMetadataText, isJsonStringifiableWithin, isRecord }
  });

  await relayStorePersistence.loadRelayStore();

  function canPublishMlsMessage(session: ClientSession, message: MlsRelayMessage): boolean {
    const sessionMatches =
      session.teamId === message.teamId &&
      session.roomId === message.roomId &&
      session.userId === message.senderUserId &&
      session.deviceId === message.senderDeviceId;
    return sessionMatches;
  }

  function revokeTeamInvites(teamId: string) {
    let revoked = false;
    for (const [inviteId, invite] of invites.entries()) {
      if (invite.teamId === teamId) {
        invites.delete(inviteId);
        for (const [requestId, request] of relayStore.inviteRequests) {
          if (request.inviteId === inviteId) relayStore.inviteRequests.delete(requestId);
        }
        for (const [requestId, response] of relayStore.inviteResponses) {
          if (response.inviteId === inviteId) relayStore.inviteResponses.delete(requestId);
        }
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

  function pruneMlsBacklog(messages: MlsRelayMessage[]): MlsRelayMessage[] {
    const normallyPruned = pruneMlsBacklogWithLimits(messages, {
      mlsBacklogLimit,
      mlsBacklogRetentionDays,
      mlsMessageMaxBytes,
      maxMlsMessageChars: relayLimits.maxMlsMessageChars,
      maxDeviceIdChars,
      maxEnvelopeIdChars,
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

export function configuredKeyPackageValidator(nodeEnv: string): KeyPackageValidator {
  const executable = process.env.MULTAIPLAYER_MLS_VALIDATOR_PATH?.trim();
  if (executable) return executableKeyPackageValidator(executable);
  if (nodeEnv === "production") throw new Error("MULTAIPLAYER_MLS_VALIDATOR_PATH is required in production.");
  return rejectUnvalidatedKeyPackages;
}
