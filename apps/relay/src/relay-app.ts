import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createRelayAuthSessionManager, createRelayAuthSessionPersistence } from "./auth/session.js";
import { createAccountRestrictionManager, isAccountRestricted } from "./auth/account-restrictions.js";
import { FileDeletionLedger, S3DeletionLedger, type DeletionLedger } from "./auth/deletion-ledger.js";
import { reconcileDeletionLedger } from "./auth/deletion-reconciliation.js";
import {
  maxAttachmentBlobIdChars,
  maxAttachmentBlobNameChars,
  maxAttachmentBlobTypeChars,
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
import { persistenceAvailabilityMiddleware } from "./http/persistence-availability.js";
import {
  createContentLengthGuard,
  relayInternalErrorMiddleware,
  relayJsonBodyErrorMiddleware,
  relayNotFoundMiddleware,
  typedRelayErrorMiddleware
} from "./http/errors.js";
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

export async function createRelayApp(
  options: {
    keyPackageValidator?: KeyPackageValidator;
    deletionLedgerForTests?: DeletionLedger;
    deleteOwnedResourcesForDeletionSubject?: string;
  } = {}
) {
  const relayConfig = loadRelayConfig();
  const keyPackageValidator = options.keyPackageValidator ?? configuredKeyPackageValidator(relayConfig.nodeEnv);
  const {
    nodeEnv,
    port,
    dataPath,
    mlsBacklogLimit,
    mlsBacklogRetentionDays,
    attachmentBlobMaxBytes,
    jsonBodyLimitBytes,
    mlsMessageMaxBytes,
    allowedCorsOrigins,
    mutationsRequireAuth,
    rateLimitsEnabled,
    trustProxyHeaders,
    maxDurableEntries,
    maxDurableEntriesPerTeam,
    structuredLogsEnabled,
    rateLimitWindowMs,
    trustedNetworkRateLimitMultiplier,
    rateLimitCaps,
    shutdown: shutdownConfig
  } = relayConfig;
  const relayMetrics = createRelayMetrics();
  // Tests may inject an in-process ledger explicitly. Runtime deletion
  // protection otherwise comes only from the validated relay configuration.
  const deletionLedger =
    options.deletionLedgerForTests ??
    (relayConfig.deletionLedger
      ? relayConfig.deletionLedger.backend === "s3"
        ? new S3DeletionLedger(relayConfig.deletionLedger)
        : new FileDeletionLedger(
            relayConfig.deletionLedger.path,
            relayConfig.deletionLedger.hmacKey,
            relayConfig.deletionLedger.protectionSeconds
          )
      : null);
  const relayPersistence = createRelayPersistence({
    dataPath,
    sqliteWalAutoCheckpointPages: relayConfig.sqliteWalAutoCheckpointPages,
    recordSqliteWriteDuration: relayMetrics.recordSqliteWriteDuration
  });
  const originPolicy = createRelayOriginPolicy({ nodeEnv, allowedCorsOrigins });
  const app = express();
  app.disable("x-powered-by");
  app.use(originPolicy.enforceAllowedOrigin);
  app.use(cors(originPolicy.corsOptions));
  app.use(cookieParser());
  app.use(originPolicy.enforceCookieMutationCsrf);
  app.use(requestLoggingMiddleware(structuredLogsEnabled));
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

  const relayStore = createRelayStore(maxDurableEntries, maxDurableEntriesPerTeam, {
    mlsBacklog: {
      global: relayConfig.maxMlsBacklogBytes,
      perTeam: relayConfig.maxMlsBacklogBytesPerTeam,
      perRoom: relayConfig.maxMlsBacklogBytesPerRoom
    },
    attachmentBlobs: {
      global: relayConfig.maxAttachmentBlobBytes,
      perTeam: relayConfig.maxAttachmentBlobBytesPerTeam
    }
  });
  const { sessions, roomSockets, teamSockets, workspaceSockets, roomPresence, authSessions, rateLimitStore } =
    relayStore;
  const relayAuthz = createRelayAuthz(relayStore);
  const { isTeamMember, canAccessRoom } = relayAuthz;
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
    isDeletedIdentity: (userId) => deletionLedger?.isProtected(userId) ?? false,
    isRestrictedIdentity: (userId) => isAccountRestricted(relayStore, userId)
  });
  const { authSessionMaxAgeMs, getAuthSession } = authSessionManager;
  const authSessionPersistence = createRelayAuthSessionPersistence({
    authSessionMaxAgeMs,
    maxDisplayNameChars,
    maxRoomProjectPathChars,
    maxUserIdChars
  });
  const { storedAuthSessions, normalizeStoredAuthSession } = authSessionPersistence;
  const relayStoreCodec = createRelayStoreCodec({
    store: relayStore,
    attachmentBlobMaxBytes,
    maxAttachmentBlobIdChars,
    maxAttachmentBlobNameChars,
    maxAttachmentBlobTypeChars,
    maxDeviceIdChars,
    maxEnvelopeIdChars,
    maxHostNameChars,
    maxMlsMessageChars: relayLimits.maxMlsMessageChars,
    maxPublicKeyJwkChars,
    maxRoomIdChars,
    maxRoomNameChars,
    maxTeamIdChars,
    maxTeamNameChars,
    maxUserIdChars,
    normalizeStoredAuthSession,
    pruneMlsBacklog,
    storedAuthSessions
  });
  let poisonRelayImpl = () => {};
  const relayStorePersistence = createRelayStorePersistenceCoordinator({
    dataPath,
    persistence: relayPersistence,
    storeCodec: relayStoreCodec,
    onPoison: () => poisonRelayImpl()
  });
  poisonRelayImpl = () => {
    for (const socket of wss.clients) socket.close(1012, "Relay persistence unavailable");
    if (relayConfig.exitOnPersistencePoison) {
      setTimeout(() => process.exit(1), 250).unref();
    }
  };
  scheduleStoreSaveImpl = () => relayStorePersistence.scheduleStoreSave();
  const relayLifecycle = createRelayLifecycle({
    server,
    wss,
    drainMs: shutdownConfig.drainMs,
    graceMs: shutdownConfig.graceMs,
    closeStore: () => relayStorePersistence.closeRelayStore()
  });
  const relayIsReady = () => relayLifecycle.isReady() && relayStorePersistence.isHealthy();
  app.use(persistenceAvailabilityMiddleware(relayStorePersistence.isHealthy));
  app.use((req, res, next) => {
    relayLifecycle.shutdownMiddleware(req.path, next, () =>
      res.status(503).json({ error: "Relay is shutting down.", code: "relay_shutting_down" })
    );
  });
  const relayRequestGuards = createRelayRequestGuards({
    rateLimitsEnabled,
    rateLimitWindowMs,
    trustedNetworkRateLimitMultiplier,
    rateLimitCaps,
    rateLimitStore,
    trustProxyHeaders,
    metrics: relayMetrics,
    normalizeSessionId: normalizeAuthSessionId,
    trustedSessionIdentity: (sessionId) => {
      const session = getAuthSession(sessionId);
      return session ? `session:${session.sessionIdHash}` : null;
    }
  });
  // This application-level guard intentionally precedes every auth and API
  // router registered below. Route-local handlers must not be mounted above it.
  app.use(relayRequestGuards.rateLimitMiddleware);
  const ordinaryJsonBodyLimitBytes = Math.min(jsonBodyLimitBytes, 2_000_000);
  app.use("/attachment-blobs", createContentLengthGuard(jsonBodyLimitBytes));
  app.use("/attachment-blobs", express.json({ limit: `${jsonBodyLimitBytes}b` }));
  app.use(createContentLengthGuard(ordinaryJsonBodyLimitBytes));
  app.use(express.json({ limit: `${ordinaryJsonBodyLimitBytes}b` }));
  let addTeamMemberImpl: ReturnType<typeof createTeamMutationHelpers>["addTeamMember"] = () => {};
  const addTeamMember: typeof addTeamMemberImpl = (...args) => addTeamMemberImpl(...args);
  const relayFanout = createRelayFanout({
    store: relayStore,
    roomSockets,
    teamSockets,
    workspaceSockets,
    sessions,
    roomPresence,
    mutationsRequireAuth,
    metrics: relayMetrics,
    roomKey,
    pruneMlsBacklog,
    addTeamMember,
    reclaimDurableCapacity: relayStorePersistence.reclaimDurableCapacity,
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
  const accountRestrictionManager = createAccountRestrictionManager({
    store: relayStore,
    liveControl: relayRoomManager,
    persist: () => relayStorePersistence.saveRelayStore()
  });

  const requesterFromRequest = createRequesterFromRequest(getAuthSession);
  registerRelayRouteAdapter({
    app,
    config: relayConfig,
    store: relayStore,
    auth: authSessionManager,
    authz: relayAuthz,
    persistence: relayStorePersistence,
    metrics: relayMetrics,
    codec: relayStoreCodec,
    fanout: relayFanout,
    roomManager: relayRoomManager,
    keyPackageValidator,
    scheduleStoreSave,
    revokeTeamInvites: teamMutations.revokeTeamInvites,
    requesterFromRequest,
    reclaimDurableCapacity: relayStorePersistence.reclaimDurableCapacity,
    deletionLedger,
    isAccountRestricted: (userId) => isAccountRestricted(relayStore, userId),
    isReady: relayIsReady,
    readinessFailureCode: () => (relayStorePersistence.isHealthy() ? "relay_shutting_down" : "persistence_unavailable")
  });
  app.use(relayJsonBodyErrorMiddleware);
  app.use(relayNotFoundMiddleware);
  app.use(relayInternalErrorMiddleware);
  registerRelayWebSocketAdapter({
    config: relayConfig,
    store: relayStore,
    limits: relayLimits,
    auth: authSessionManager,
    guards: relayRequestGuards,
    metrics: relayMetrics,
    fanout: relayFanout,
    roomManager: relayRoomManager,
    wss,
    isReady: relayIsReady
  });

  await relayStorePersistence.loadRelayStore();
  const restrictionStartup = accountRestrictionManager.evictRestrictedAccounts();
  if (restrictionStartup.removedAuthSessions > 0 || restrictionStartup.removedRestrictions > 0) {
    await relayStorePersistence.saveRelayStore();
  }
  const deletionReconciliation = deletionLedger
    ? await reconcileDeletionLedger({
        ledger: deletionLedger,
        store: relayStore,
        persist: () => relayStorePersistence.saveRelayStore(),
        ...(options.deleteOwnedResourcesForDeletionSubject
          ? { deleteOwnedResourcesForSubject: options.deleteOwnedResourcesForDeletionSubject }
          : {})
      })
    : { entries: 0, pending: 0, identitiesDeleted: 0, markersPruned: 0, conflictsResolved: 0 };
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
    accountRestrictions: accountRestrictionManager,
    ...runtime
  };
}
