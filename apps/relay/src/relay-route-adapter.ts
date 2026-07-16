import type express from "express";
import {
  maxAccessTokenChars,
  maxAttachmentBlobNameChars,
  maxAttachmentBlobTypeChars,
  maxDeviceIdChars,
  maxDisplayNameChars,
  maxEnvelopeIdChars,
  maxHostNameChars,
  maxMediumTextChars,
  maxPublicKeyFingerprintChars,
  maxPublicKeyJwkChars,
  maxRoomNameChars,
  maxRoomProjectPathChars,
  maxShortTextChars,
  maxTeamNameChars,
  maxUrlChars,
  maxUserIdChars
} from "@multaiplayer/protocol";
import type { createRelayAuthSessionManager } from "./auth/session.js";
import type { DeletionLedger } from "./auth/deletion-ledger.js";
import type { createRelayAuthz } from "./authz.js";
import type { loadRelayConfig } from "./config.js";
import { registerRelayRoutes } from "./http/register-routes.js";
import {
  isApprovalPolicy,
  maxCiphertextCharactersForBlob,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  parseIntegerValue
} from "./limits.js";
import type { KeyPackageValidator } from "./mls/key-package-validator.js";
import type { createRelayMetrics } from "./observability.js";
import { displayNameForUser, isRoomHost } from "./relay-domain.js";
import type { RelayStore } from "./state.js";
import type { RelayStoreCodec } from "./store-codec.js";
import type { RelayStorePersistenceCoordinator } from "./store-persistence.js";
import type { createRelayFanout } from "./ws/fanout.js";
import type { createRelayRoomSocketManager } from "./ws/rooms.js";

interface RegisterRelayRouteAdapterOptions {
  app: express.Express;
  config: ReturnType<typeof loadRelayConfig>;
  store: RelayStore;
  identity: {
    sessions: ReturnType<typeof createRelayAuthSessionManager>;
    authorization: ReturnType<typeof createRelayAuthz>;
    deletionLedger: DeletionLedger | null;
    isAccountRestricted: (userId: string) => boolean;
  };
  durability: {
    persistence: RelayStorePersistenceCoordinator;
    codec: RelayStoreCodec;
    scheduleStoreSave: () => void;
    reclaimDurableCapacity: () => Promise<void>;
  };
  collaboration: {
    fanout: ReturnType<typeof createRelayFanout>;
    roomManager: ReturnType<typeof createRelayRoomSocketManager>;
    revokeTeamInvites: (teamId: string) => void;
    requesterFromRequest: (body: unknown, sessionId: unknown) => { id: string; name: string };
    keyPackageValidator: KeyPackageValidator;
  };
  operations: {
    metrics: ReturnType<typeof createRelayMetrics>;
    isReady: () => boolean;
    readinessFailureCode: () => "relay_shutting_down" | "persistence_unavailable";
  };
}

export function registerRelayRouteAdapter(options: RegisterRelayRouteAdapterOptions) {
  const { config, store } = options;
  const { sessions: auth, authorization: authz } = options.identity;
  const { persistence, codec, scheduleStoreSave, reclaimDurableCapacity } = options.durability;
  const { fanout, roomManager, revokeTeamInvites, requesterFromRequest, keyPackageValidator } = options.collaboration;
  const { metrics, isReady, readinessFailureCode } = options.operations;
  const saveRelayStore = () => persistence.saveRelayStore();
  const notifyInviteRequested = (inviteId: string, requestId: string) => {
    const invite = store.getInvite(inviteId);
    const room = invite ? store.getRoom(invite.roomId) : undefined;
    if (!room?.hostUserId || !room.activeHostDeviceId) return;
    for (const session of store.sessions.values()) {
      if (
        session.roomId === room.id &&
        session.userId === room.hostUserId &&
        session.deviceId === room.activeHostDeviceId
      ) {
        fanout.send(session.socket, { type: "invite.requested", inviteId, requestId });
      }
    }
  };

  registerRelayRoutes({
    github: {
      app: options.app,
      mutationsRequireAuth: config.mutationsRequireAuth,
      allowedCorsOrigins: config.allowedCorsOrigins,
      setAuthSession: auth.setAuthSession,
      deleteAuthSession: auth.deleteAuthSession,
      store,
      deletionLedger: options.identity.deletionLedger,
      authSessionMaxAgeMs: auth.authSessionMaxAgeMs,
      authCookieOptions: auth.authCookieOptions,
      getAuthSession: auth.getAuthSession,
      scheduleStoreSave,
      saveRelayStore,
      revokeTeamMemberSessions: roomManager.revokeTeamMemberSessions,
      revokeUserPresence: roomManager.revokeUserPresence,
      normalizeMetadataText,
      maxUserIdChars,
      maxDisplayNameChars,
      maxRoomProjectPathChars,
      maxAccessTokenChars,
      isAccountRestricted: options.identity.isAccountRestricted,
      maxShortTextChars,
      maxMediumTextChars,
      maxUrlChars
    },
    debug: {
      app: options.app,
      debugEndpointsEnabled: config.debugEndpointsEnabled,
      store,
      invites: store.invites,
      attachmentBlobs: store.attachmentBlobs,
      setAuthSession: auth.setAuthSession,
      authSessionMaxAgeMs: auth.authSessionMaxAgeMs,
      authCookieOptions: auth.authCookieOptions,
      scheduleStoreSave,
      pruneExpiredRelayState: codec.pruneExpiredRelayState,
      parseIntegerValue,
      normalizeMetadataText,
      maxUserIdChars,
      maxDisplayNameChars
    },
    attachments: {
      app: options.app,
      store,
      attachmentBlobMaxBytes: config.attachmentBlobMaxBytes,
      attachmentBlobLiveQuotaBytes: config.attachmentBlobLiveQuotaBytes,
      attachmentBlobTeamLiveQuotaBytes: config.attachmentBlobTeamLiveQuotaBytes,
      attachmentBlobUploadBytesPerWindow: config.attachmentBlobUploadBytesPerWindow,
      attachmentBlobUploadWindowMs: config.attachmentBlobUploadWindowMs,
      attachmentBlobTtlDays: config.attachmentBlobTtlDays,
      maxAttachmentBlobNameChars,
      maxAttachmentBlobTypeChars,
      getAuthSession: auth.getAuthSession,
      allowRead: auth.allowRead,
      allowMutation: auth.allowMutation,
      canAccessRoom: authz.canAccessRoom,
      scheduleStoreSave,
      saveRelayStore,
      reclaimDurableCapacity,
      recordQuotaRejection: metrics.recordQuotaRejection,
      recordCapacityRejection: metrics.recordCapacityRejection,
      recordUpload: metrics.recordAttachmentBlobUpload,
      recordUploadRejection: metrics.recordAttachmentBlobUploadRejection,
      normalizeMetadataText,
      maxCiphertextCharactersForBlob,
      isExpiredAttachmentBlob: codec.isExpiredAttachmentBlob
    },
    invites: {
      app: options.app,
      store,
      inviteTtlDays: config.inviteTtlDays,
      getAuthSession: auth.getAuthSession,
      allowMutation: auth.allowMutation,
      canAccessRoom: authz.canAccessRoom,
      scheduleStoreSave,
      saveRelayStore,
      liveInviteCapPerUser: config.liveInviteCapPerUser,
      recordQuotaRejection: metrics.recordQuotaRejection
    },
    inviteDelivery: {
      app: options.app,
      store,
      getAuthSession: auth.getAuthSession,
      allowRead: auth.allowRead,
      allowMutation: auth.allowMutation,
      saveRelayStore,
      notifyInviteRequested,
      normalizeMetadataText,
      maxDeviceIdChars,
      maxEnvelopeIdChars
    },
    keyPackages: {
      app: options.app,
      store,
      validator: keyPackageValidator,
      getAuthSession: auth.getAuthSession,
      allowRead: auth.allowRead,
      allowMutation: auth.allowMutation,
      saveRelayStore,
      liveKeyPackageCapPerUser: config.liveKeyPackageCapPerUser,
      recordQuotaRejection: metrics.recordQuotaRejection
    },
    teams: {
      app: options.app,
      store,
      getAuthSession: auth.getAuthSession,
      allowRead: auth.allowRead,
      allowMutation: auth.allowMutation,
      teamIdsForUser: authz.teamIdsForUser,
      isTeamMember: authz.isTeamMember,
      teamRoleRank: authz.teamRoleRank,
      canSetTeamMemberRole: authz.canSetTeamMemberRole,
      canRemoveTeamMember: authz.canRemoveTeamMember,
      transferTeamOwnership: authz.transferTeamOwnership,
      revokeTeamInvites,
      revokeTeamMemberSessions: roomManager.revokeTeamMemberSessions,
      broadcastWorkspaceUpdated: fanout.broadcastWorkspaceUpdated,
      broadcastRoomUpdated: fanout.broadcastRoomUpdated,
      scheduleStoreSave,
      saveRelayStore,
      recordQuotaRejection: metrics.recordQuotaRejection,
      recordCapacityRejection: metrics.recordCapacityRejection,
      normalizeMetadataText,
      maxTeamNameChars,
      dailyCreationCaps: config.dailyCreationCaps
    },
    devices: {
      app: options.app,
      store,
      getAuthSession: auth.getAuthSession,
      allowRead: auth.allowRead,
      allowMutation: auth.allowMutation,
      scheduleStoreSave,
      normalizeMetadataText,
      normalizeOptionalMetadataText,
      displayNameForUser,
      maxDisplayNameChars,
      maxDeviceIdChars,
      maxPublicKeyFingerprintChars,
      maxPublicKeyJwkChars,
      maxUserIdChars
    },
    deviceAuth: {
      app: options.app,
      store,
      getAuthSession: auth.getAuthSession,
      allowMutation: auth.allowMutation
    },
    operations: {
      app: options.app,
      dataPath: config.dataPath,
      metrics,
      metricsToken: config.metricsToken,
      sessions: store.sessions,
      attachmentBlobs: store.attachmentBlobs.values(),
      isExpiredAttachmentBlob: codec.isExpiredAttachmentBlob,
      retainedByteUsage: () => store.retainedByteUsage(),
      retainedByteLimits: {
        mlsBacklogBytes: config.maxMlsBacklogBytes,
        attachmentBlobBytes: config.maxAttachmentBlobBytes
      },
      isReady,
      readinessFailureCode
    },
    rooms: {
      app: options.app,
      store,
      getAuthSession: auth.getAuthSession,
      allowMutation: auth.allowMutation,
      teamIdsForUser: authz.teamIdsForUser,
      isTeamMember: authz.isTeamMember,
      canAccessRoom: authz.canAccessRoom,
      scheduleStoreSave,
      saveRelayStore,
      broadcastRoomUpdated: fanout.broadcastRoomUpdated,
      recordQuotaRejection: metrics.recordQuotaRejection,
      recordCapacityRejection: metrics.recordCapacityRejection,
      requesterFromRequest,
      isRoomHost,
      isApprovalPolicy,
      normalizeMetadataText,
      normalizeOptionalMetadataText,
      displayNameForUser,
      maxDeviceIdChars,
      maxHostNameChars,
      maxRoomNameChars,
      maxUserIdChars,
      deviceAuthRequired: config.mutationsRequireAuth,
      dailyCreationCaps: config.dailyCreationCaps,
      totalRoomCapPerUser: config.totalRoomCapPerUser
    }
  });
}
