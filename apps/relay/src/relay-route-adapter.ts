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
  isApprovalDelegationPolicy,
  isApprovalPolicy,
  isRoomMode,
  maxCiphertextCharactersForBlob,
  normalizeBrowserAllowedOrigins,
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
  auth: ReturnType<typeof createRelayAuthSessionManager>;
  authz: ReturnType<typeof createRelayAuthz>;
  persistence: RelayStorePersistenceCoordinator;
  metrics: ReturnType<typeof createRelayMetrics>;
  codec: RelayStoreCodec;
  fanout: ReturnType<typeof createRelayFanout>;
  roomManager: ReturnType<typeof createRelayRoomSocketManager>;
  keyPackageValidator: KeyPackageValidator;
  scheduleStoreSave: () => void;
  revokeTeamInvites: (teamId: string) => void;
  requesterFromRequest: (body: unknown, sessionId: unknown) => { id: string; name: string };
  deletionLedger: DeletionLedger | null;
  isAccountRestricted: (userId: string) => boolean;
  isReady: () => boolean;
  readinessFailureCode: () => "relay_shutting_down" | "persistence_unavailable";
}

export function registerRelayRouteAdapter(options: RegisterRelayRouteAdapterOptions) {
  const { config, store, auth, authz, metrics, codec, fanout, roomManager } = options;
  registerRelayRoutes({
    app: options.app,
    store,
    mutationsRequireAuth: config.mutationsRequireAuth,
    deviceAuthRequired: config.mutationsRequireAuth,
    allowedCorsOrigins: config.allowedCorsOrigins,
    setAuthSession: auth.setAuthSession,
    deleteAuthSession: auth.deleteAuthSession,
    deletionLedger: options.deletionLedger,
    isAccountRestricted: options.isAccountRestricted,
    authSessionMaxAgeMs: auth.authSessionMaxAgeMs,
    authCookieOptions: auth.authCookieOptions,
    getAuthSession: auth.getAuthSession,
    scheduleStoreSave: options.scheduleStoreSave,
    saveRelayStore: () => options.persistence.saveRelayStore(),
    notifyInviteRequested: (inviteId: string, requestId: string) => {
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
    },
    normalizeMetadataText,
    maxUserIdChars,
    maxDisplayNameChars,
    maxRoomProjectPathChars,
    maxAccessTokenChars,
    maxShortTextChars,
    maxMediumTextChars,
    maxUrlChars,
    debugEndpointsEnabled: config.debugEndpointsEnabled,
    invites: store.invites,
    attachmentBlobs: store.attachmentBlobs,
    pruneExpiredRelayState: codec.pruneExpiredRelayState,
    parseIntegerValue,
    attachmentBlobMaxBytes: config.attachmentBlobMaxBytes,
    attachmentBlobLiveQuotaBytes: config.attachmentBlobLiveQuotaBytes,
    attachmentBlobTeamLiveQuotaBytes: config.attachmentBlobTeamLiveQuotaBytes,
    attachmentBlobUploadBytesPerWindow: config.attachmentBlobUploadBytesPerWindow,
    attachmentBlobUploadWindowMs: config.attachmentBlobUploadWindowMs,
    attachmentBlobTtlDays: config.attachmentBlobTtlDays,
    maxAttachmentBlobNameChars,
    maxAttachmentBlobTypeChars,
    allowRead: auth.allowRead,
    allowMutation: auth.allowMutation,
    recordQuotaRejection: metrics.recordQuotaRejection,
    recordUpload: metrics.recordAttachmentBlobUpload,
    recordUploadRejection: metrics.recordAttachmentBlobUploadRejection,
    maxCiphertextCharactersForBlob,
    isExpiredAttachmentBlob: codec.isExpiredAttachmentBlob,
    inviteTtlDays: config.inviteTtlDays,
    liveInviteCapPerUser: config.liveInviteCapPerUser,
    liveKeyPackageCapPerUser: config.liveKeyPackageCapPerUser,
    canAccessRoom: authz.canAccessRoom,
    teamIdsForUser: authz.teamIdsForUser,
    isTeamMember: authz.isTeamMember,
    teamRoleRank: authz.teamRoleRank,
    canSetTeamMemberRole: authz.canSetTeamMemberRole,
    canRemoveTeamMember: authz.canRemoveTeamMember,
    transferTeamOwnership: authz.transferTeamOwnership,
    revokeTeamInvites: options.revokeTeamInvites,
    revokeTeamMemberSessions: roomManager.revokeTeamMemberSessions,
    revokeUserPresence: roomManager.revokeUserPresence,
    broadcastWorkspaceUpdated: fanout.broadcastWorkspaceUpdated,
    broadcastRoomUpdated: fanout.broadcastRoomUpdated,
    maxTeamNameChars,
    normalizeOptionalMetadataText,
    displayNameForUser,
    maxDeviceIdChars,
    maxEnvelopeIdChars,
    maxPublicKeyFingerprintChars,
    maxPublicKeyJwkChars,
    dataPath: config.dataPath,
    metricsToken: config.metricsToken,
    metrics,
    validator: options.keyPackageValidator,
    sessions: store.sessions,
    opsAttachmentBlobs: store.attachmentBlobs.values(),
    isReady: options.isReady,
    readinessFailureCode: options.readinessFailureCode,
    requesterFromRequest: options.requesterFromRequest,
    isRoomHost,
    isApprovalPolicy,
    isApprovalDelegationPolicy,
    isRoomMode,
    normalizeBrowserAllowedOrigins,
    maxHostNameChars,
    maxRoomNameChars
  });
}
