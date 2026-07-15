import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createRelayAuthSessionManager, createRelayAuthSessionPersistence } from "./auth/session.js";
import { FileDeletionLedger, S3DeletionLedger } from "./auth/deletion-ledger.js";
import { reconcileDeletionLedger } from "./auth/deletion-reconciliation.js";
import {
  maxAccessTokenChars,
  maxAttachmentBlobIdChars,
  maxAttachmentBlobNameChars,
  maxAttachmentBlobTypeChars,
  maxAuthSessionIdChars,
  maxCodexModelChars,
  maxDeviceIdChars,
  maxDisplayNameChars,
  maxEnvelopeIdChars,
  maxHostNameChars,
  maxPublicKeyFingerprintChars,
  maxPublicKeyJwkChars,
  maxRoomIdChars,
  maxRoomNameChars,
  maxRoomProjectPathChars,
  maxTeamIdChars,
  maxTeamNameChars,
  maxUserIdChars
} from "@multaiplayer/protocol";
import { createRelayAuthz } from "./authz.js";
import { loadRelayConfig } from "./config.js";
import { createRelayRequestGuards } from "./http/middleware.js";
import { relayJsonBodyErrorMiddleware, typedRelayErrorMiddleware } from "./http/errors.js";
import { createRelayOriginPolicy } from "./http/origin-policy.js";
import { teamRecordForUser } from "./http/teams.js";
import { createRelayLifecycle } from "./lifecycle.js";
import { createRelayLimits } from "./limits.js";
import { createRelayMetrics, logRelayEvent, requestLoggingMiddleware } from "./observability.js";
import { createRelayPersistence } from "./persistence.js";
import {
  createMlsBacklogPruner,
  createRequesterFromRequest,
  createTeamMutationHelpers,
  normalizeAuthSessionId,
  roomKey
} from "./relay-domain.js";
import { registerRelayRouteAdapter } from "./relay-route-adapter.js";
import { registerRelayWebSocketAdapter } from "./relay-websocket-adapter.js";
import { createRelayStore } from "./state.js";
import { createRelayStoreCodec } from "./store-codec.js";
import { createRelayStorePersistenceCoordinator } from "./store-persistence.js";
import { createRelayFanout } from "./ws/fanout.js";
import { createRelayRoomSocketManager } from "./ws/rooms.js";
import { createRelayRuntimeControl } from "./runtime-control.js";
import { configuredKeyPackageValidator } from "./mls/configured-validator.js";
import type { KeyPackageValidator } from "./mls/key-package-validator.js";

export { configuredKeyPackageValidator } from "./mls/configured-validator.js";

export async function createRelayApp(options: { keyPackageValidator?: KeyPackageValidator } = {}) {
  const relayConfig = loadRelayConfig();
  const keyPackageValidator = options.keyPackageValidator ?? configuredKeyPackageValidator(relayConfig.nodeEnv);
  const {
    nodeEnv,
    port,
    dataPath,
    storageBackend,
    legacyJsonImportPath,
    mlsBacklogLimit,
    mlsBacklogRetentionDays,
    attachmentBlobMaxBytes,
    jsonBodyLimitBytes,
    mlsMessageMaxBytes,
    sessionPersistenceSecret,
    allowedCorsOrigins,
    mutationsRequireAuth,
    rateLimitsEnabled,
    trustProxyHeaders,
    structuredLogsEnabled,
    rateLimitWindowMs,
    rateLimitCaps,
    shutdown: shutdownConfig
  } = relayConfig;
  const relayMetrics = createRelayMetrics();
  const deletionLedger = relayConfig.deletionLedger
    ? relayConfig.deletionLedger.backend === "s3"
      ? new S3DeletionLedger(relayConfig.deletionLedger)
      : new FileDeletionLedger(
          relayConfig.deletionLedger.path,
          relayConfig.deletionLedger.hmacKey,
          relayConfig.deletionLedger.protectionSeconds
        )
    : null;
  const relayPersistence = createRelayPersistence({
    backend: storageBackend,
    dataPath,
    legacyJsonImportPath,
    recordSqliteWriteDuration: relayMetrics.recordSqliteWriteDuration
  });
  const originPolicy = createRelayOriginPolicy({ nodeEnv, allowedCorsOrigins });
  const app = express();
  app.use(originPolicy.enforceAllowedOrigin);
  app.use(cors(originPolicy.corsOptions));
  app.use(cookieParser());
  app.use(requestLoggingMiddleware(structuredLogsEnabled));
  app.use(express.json({ limit: `${jsonBodyLimitBytes}b` }));
  app.use(typedRelayErrorMiddleware);

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
  const { sessions, roomSockets, teamSockets, workspaceSockets, roomPresence, authSessions, rateLimitStore } =
    relayStore;
  const relayAuthz = createRelayAuthz(relayStore);
  const { isTeamMember, canAccessRoom } = relayAuthz;
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
  const pruneMlsBacklog = createMlsBacklogPruner({
    mlsBacklogLimit,
    mlsBacklogRetentionDays,
    mlsMessageMaxBytes,
    maxMlsMessageChars: relayLimits.maxMlsMessageChars,
    maxDeviceIdChars,
    maxEnvelopeIdChars,
    maxPublicKeyJwkChars,
    maxUserIdChars
  });
  let scheduleStoreSaveImpl = () => {};
  const scheduleStoreSave = () => scheduleStoreSaveImpl();

  const authSessionManager = createRelayAuthSessionManager({
    authSessions,
    mutationsRequireAuth,
    nodeEnv,
    normalizeSessionId: normalizeAuthSessionId,
    scheduleStoreSave,
    isDeletedIdentity: (userId) => deletionLedger?.isProtected(userId) ?? false
  });
  const { authSessionMaxAgeMs, getAuthSession } = authSessionManager;
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
  const relayStorePersistence = createRelayStorePersistenceCoordinator({
    dataPath,
    persistence: relayPersistence,
    storeCodec: relayStoreCodec
  });
  scheduleStoreSaveImpl = () => relayStorePersistence.scheduleStoreSave();
  const relayLifecycle = createRelayLifecycle({
    server,
    wss,
    drainMs: shutdownConfig.drainMs,
    graceMs: shutdownConfig.graceMs,
    closeStore: () => relayStorePersistence.closeRelayStore()
  });
  app.use((req, res, next) => {
    relayLifecycle.shutdownMiddleware(req.path, next, () =>
      res.status(503).json({ error: "Relay is shutting down.", code: "relay_shutting_down" })
    );
  });
  const relayRequestGuards = createRelayRequestGuards({
    rateLimitsEnabled,
    rateLimitWindowMs,
    rateLimitCaps,
    rateLimitStore,
    trustProxyHeaders,
    metrics: relayMetrics,
    normalizeSessionId: normalizeAuthSessionId
  });
  let addTeamMemberImpl: ReturnType<typeof createTeamMutationHelpers>["addTeamMember"] = () => {};
  const addTeamMember: typeof addTeamMemberImpl = (...args) => addTeamMemberImpl(...args);
  const relayFanout = createRelayFanout({
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
    saveMlsMessage: (roomKey, message, prunedIds) => relayStorePersistence.saveMlsMessage(roomKey, message, prunedIds),
    saveMlsCommit: (roomKey, message, prunedIds) => relayStorePersistence.saveMlsCommit(roomKey, message, prunedIds),
    teamRecordForUser
  });
  const teamMutations = createTeamMutationHelpers({
    store: relayStore,
    scheduleStoreSave,
    broadcastWorkspaceUpdated: relayFanout.broadcastWorkspaceUpdated
  });
  addTeamMemberImpl = teamMutations.addTeamMember;
  const relayRoomManager = createRelayRoomSocketManager({
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
    send: relayFanout.send,
    broadcast: relayFanout.broadcast
  });

  app.use(relayRequestGuards.rateLimitMiddleware);
  const requesterFromRequest = createRequesterFromRequest(getAuthSession);
  registerRelayRouteAdapter({
    app,
    config: relayConfig,
    store: relayStore,
    auth: authSessionManager,
    authz: relayAuthz,
    persistence: relayStorePersistence,
    metrics: relayMetrics,
    lifecycle: relayLifecycle,
    codec: relayStoreCodec,
    fanout: relayFanout,
    roomManager: relayRoomManager,
    keyPackageValidator,
    scheduleStoreSave,
    addTeamMember,
    revokeTeamInvites: teamMutations.revokeTeamInvites,
    requesterFromRequest,
    deletionLedger
  });
  app.use(relayJsonBodyErrorMiddleware);
  registerRelayWebSocketAdapter({
    config: relayConfig,
    store: relayStore,
    limits: relayLimits,
    auth: authSessionManager,
    guards: relayRequestGuards,
    metrics: relayMetrics,
    lifecycle: relayLifecycle,
    fanout: relayFanout,
    roomManager: relayRoomManager,
    wss
  });

  await relayStorePersistence.loadRelayStore();
  const deletionReconciliation = deletionLedger
    ? await reconcileDeletionLedger({
        ledger: deletionLedger,
        store: relayStore,
        persist: () => relayStorePersistence.saveRelayStore()
      })
    : { entries: 0, pending: 0, identitiesDeleted: 0, markersPruned: 0 };
  if (deletionLedger) {
    logRelayEvent("info", "deletion_ledger_reconciled", deletionReconciliation);
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
    deletionReconciliation,
    ...runtime
  };
}
