import {
  AttachmentBlobRecord,
  InviteRecord,
  RelayEnvelope,
  isRecord,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultApprovalDelegationPolicy,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSpeed,
  legacyCodexCatalogSelectionPolicy,
  defaultRoomMode,
  type AttachmentBlobRecord as AttachmentBlobRecordType,
  type DeviceRecord,
  type InviteRecord as InviteRecordType,
  type RoomRecord,
  type TeamMemberRecord,
  type TeamRecord
} from "@multaiplayer/protocol";
import type { NormalizedStoredAuthSession, StoredAuthSession } from "./auth/session.js";
import {
  isApprovalPolicy,
  isApprovalDelegationPolicy,
  isRoomMode,
  maxCiphertextCharactersForBlob,
  normalizeBrowserAllowedOrigins,
  normalizeCodexModel,
  normalizeCodexCatalogSelectionPolicy,
  normalizeCodexReasoningEffortOrDefault,
  normalizeCodexSpeedOrDefault,
  normalizeDevicePublicKeyJwk,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRelayId,
  normalizeRoomProjectPath,
  normalizeTeamRole
} from "./limits.js";
import type { AuthSession, RelayStore, RoomKey } from "./state.js";

export interface StoredRelayState {
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

export interface RelayStoreCodec {
  isExpiredInvite(invite: InviteRecordType): boolean;
  isExpiredAttachmentBlob(blob: AttachmentBlobRecordType): boolean;
  applyStoredRelayState(stored: Record<string, unknown>): void;
  pruneExpiredRelayState(): void;
  toStoredRelayState(): StoredRelayState;
}

export function createRelayStoreCodec(options: {
  store: RelayStore;
  attachmentBlobMaxBytes: number;
  maxAttachmentBlobIdChars: number;
  maxAttachmentBlobNameChars: number;
  maxAttachmentBlobTypeChars: number;
  maxCodexModelChars: number;
  maxDeviceIdChars: number;
  maxDisplayNameChars: number;
  maxEnvelopeIdChars: number;
  maxEnvelopeNonceChars: number;
  maxHostNameChars: number;
  maxPublicKeyFingerprintChars: number;
  maxPublicKeyJwkChars: number;
  maxRoomIdChars: number;
  maxRoomNameChars: number;
  maxRoomProjectPathChars: number;
  maxTeamIdChars: number;
  maxTeamNameChars: number;
  maxUserIdChars: number;
  isAllowedEnvelopePayload: (envelope: RelayEnvelope) => boolean;
  normalizeStoredAuthSession: (stored: unknown) => NormalizedStoredAuthSession | null;
  pruneEncryptedBacklog: (envelopes: RelayEnvelope[]) => RelayEnvelope[];
  storedAuthSessions: (authSessions: Map<string, AuthSession>) => StoredAuthSession[];
}): RelayStoreCodec {
  const { store } = options;

  function deviceKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  function roomKey(teamId: string, roomId: string): RoomKey {
    return `${teamId}:${roomId}`;
  }

  function isKnownRoom(teamId: string, roomId: string): boolean {
    return store.rooms.get(roomId)?.teamId === teamId;
  }

  function normalizeDevicePublicKey(value: unknown) {
    return normalizeDevicePublicKeyJwk(value, options.maxPublicKeyJwkChars);
  }

  function normalizeProjectPath(value: unknown): string | null {
    return normalizeRoomProjectPath(value, options.maxRoomProjectPathChars);
  }

  function normalizeModel(value: unknown): string | null {
    return normalizeCodexModel(value, options.maxCodexModelChars);
  }

  function normalizeTeam(team: unknown): TeamRecord | null {
    if (!isRecord(team)) return null;
    const id = normalizeRelayId(team.id, options.maxTeamIdChars);
    const name = normalizeMetadataText(team.name, options.maxTeamNameChars);
    if (!id || !name) return null;
    const members =
      typeof team.members === "number" && Number.isSafeInteger(team.members) && team.members >= 0 ? team.members : 0;
    const archivedAt =
      typeof team.archivedAt === "string" && !Number.isNaN(Date.parse(team.archivedAt)) ? team.archivedAt : undefined;
    const deletedAt =
      typeof team.deletedAt === "string" && !Number.isNaN(Date.parse(team.deletedAt)) ? team.deletedAt : undefined;
    return { id, name, members, archivedAt, deletedAt };
  }

  function normalizeDevice(device: unknown): DeviceRecord | null {
    if (!isRecord(device)) return null;
    const publicKeyJwk = normalizeDevicePublicKey(device.publicKeyJwk);
    const userId = normalizeMetadataText(device.userId, options.maxUserIdChars);
    const deviceId = normalizeMetadataText(device.deviceId, options.maxDeviceIdChars);
    const displayName = normalizeMetadataText(device.displayName, options.maxDisplayNameChars);
    const publicKeyFingerprint = normalizeMetadataText(
      device.publicKeyFingerprint,
      options.maxPublicKeyFingerprintChars
    );
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
    const id = normalizeRelayId(parsed.data.id, options.maxEnvelopeIdChars);
    if (!id) return null;
    if (!store.teams.has(parsed.data.teamId)) return null;
    if (!store.rooms.has(parsed.data.roomId) || store.rooms.get(parsed.data.roomId)?.teamId !== parsed.data.teamId)
      return null;
    if (Number.isNaN(Date.parse(parsed.data.createdAt))) return null;
    if (parsed.data.expiresAt && Number.isNaN(Date.parse(parsed.data.expiresAt))) return null;
    return { ...parsed.data, id };
  }

  function normalizeAttachmentBlob(blob: unknown): AttachmentBlobRecordType | null {
    const parsed = AttachmentBlobRecord.safeParse(blob);
    if (!parsed.success) return null;
    const id = normalizeRelayId(parsed.data.id, options.maxAttachmentBlobIdChars);
    const name = normalizeMetadataText(parsed.data.name, options.maxAttachmentBlobNameChars);
    const type = normalizeMetadataText(parsed.data.type, options.maxAttachmentBlobTypeChars);
    if (!id || !name || !type) return null;
    if (!store.teams.has(parsed.data.teamId)) return null;
    if (!store.rooms.has(parsed.data.roomId) || store.rooms.get(parsed.data.roomId)?.teamId !== parsed.data.teamId)
      return null;
    if (parsed.data.size > options.attachmentBlobMaxBytes) return null;
    if (parsed.data.payload.nonce.length > options.maxEnvelopeNonceChars) return null;
    if (parsed.data.payload.ciphertext.length > maxCiphertextCharactersForBlob(options.attachmentBlobMaxBytes))
      return null;
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

  function normalizeStoredBacklog(item: unknown): { key: RoomKey; envelopes: RelayEnvelope[] } | null {
    if (!isRecord(item) || typeof item.key !== "string" || !Array.isArray(item.envelopes)) return null;
    const [teamId, roomId, extra] = item.key.split(":");
    if (extra !== undefined || !teamId || !roomId || !isKnownRoom(teamId, roomId)) return null;

    const envelopes: RelayEnvelope[] = [];
    for (const candidate of item.envelopes) {
      const parsed = RelayEnvelope.safeParse(candidate);
      if (!parsed.success) continue;
      if (parsed.data.teamId !== teamId || parsed.data.roomId !== roomId) continue;
      if (!options.isAllowedEnvelopePayload(parsed.data)) continue;
      envelopes.push(parsed.data);
    }

    const pruned = options.pruneEncryptedBacklog(envelopes);
    return pruned.length ? { key: roomKey(teamId, roomId), envelopes: pruned } : null;
  }

  function normalizeRoom(room: unknown): RoomRecord | null {
    if (!isRecord(room)) return null;
    const id = normalizeRelayId(room.id, options.maxRoomIdChars);
    const teamId = normalizeRelayId(room.teamId, options.maxTeamIdChars);
    if (!id || !teamId || !store.teams.has(teamId)) return null;
    const hostStatus =
      room.hostStatus === "active" || room.hostStatus === "handoff" || room.hostStatus === "offline"
        ? room.hostStatus
        : "offline";
    const name = normalizeMetadataText(room.name, options.maxRoomNameChars) ?? "Untitled room";
    const host =
      hostStatus === "offline" ? "No host" : (normalizeMetadataText(room.host, options.maxHostNameChars) ?? "No host");
    const hostUserId =
      hostStatus === "offline"
        ? undefined
        : normalizeOptionalMetadataText(room.hostUserId, options.maxUserIdChars) || undefined;
    const approvalPolicy =
      typeof room.approvalPolicy === "string" && isApprovalPolicy(room.approvalPolicy)
        ? room.approvalPolicy
        : "ask_every_turn";
    const approvalDelegationPolicy =
      typeof (room as { approvalDelegationPolicy?: unknown }).approvalDelegationPolicy === "string" &&
      isApprovalDelegationPolicy((room as { approvalDelegationPolicy: string }).approvalDelegationPolicy)
        ? (room as { approvalDelegationPolicy: RoomRecord["approvalDelegationPolicy"] }).approvalDelegationPolicy
        : defaultApprovalDelegationPolicy;
    const trustedApproverUserIds = Array.isArray((room as { trustedApproverUserIds?: unknown }).trustedApproverUserIds)
      ? (room as { trustedApproverUserIds: unknown[] }).trustedApproverUserIds
          .map((item) => normalizeMetadataText(item, options.maxUserIdChars))
          .filter((item): item is string => Boolean(item))
          .slice(0, 50)
      : [];
    const mode = isRoomMode(room.mode) ? room.mode : defaultRoomMode;
    const unread =
      typeof room.unread === "number" && Number.isSafeInteger(room.unread) && room.unread >= 0 ? room.unread : 0;
    const archivedAt =
      typeof room.archivedAt === "string" && !Number.isNaN(Date.parse(room.archivedAt)) ? room.archivedAt : undefined;
    const deletedAt =
      typeof room.deletedAt === "string" && !Number.isNaN(Date.parse(room.deletedAt)) ? room.deletedAt : undefined;
    return {
      id,
      teamId,
      keyEpoch:
        typeof room.keyEpoch === "number" && Number.isSafeInteger(room.keyEpoch) && room.keyEpoch > 0
          ? room.keyEpoch
          : 1,
      epochEnvelopeCount:
        typeof room.epochEnvelopeCount === "number" &&
        Number.isSafeInteger(room.epochEnvelopeCount) &&
        room.epochEnvelopeCount >= 0
          ? room.epochEnvelopeCount
          : 0,
      name,
      projectPath: normalizeProjectPath(room.projectPath) ?? "/",
      host,
      hostUserId,
      hostStatus,
      approvalPolicy,
      approvalDelegationPolicy,
      trustedApproverUserIds,
      mode,
      codexModel: normalizeModel(room.codexModel) ?? defaultCodexModel,
      codexModelPolicy:
        normalizeCodexCatalogSelectionPolicy((room as { codexModelPolicy?: unknown }).codexModelPolicy) ??
        legacyCodexCatalogSelectionPolicy,
      codexReasoningEffort: normalizeCodexReasoningEffortOrDefault(
        (room as { codexReasoningEffort?: unknown }).codexReasoningEffort ?? defaultCodexReasoningEffort
      ),
      codexReasoningEffortPolicy:
        normalizeCodexCatalogSelectionPolicy(
          (room as { codexReasoningEffortPolicy?: unknown }).codexReasoningEffortPolicy
        ) ?? legacyCodexCatalogSelectionPolicy,
      codexSpeed: normalizeCodexSpeedOrDefault((room as { codexSpeed?: unknown }).codexSpeed ?? defaultCodexSpeed),
      codexServiceTierPolicy:
        normalizeCodexCatalogSelectionPolicy((room as { codexServiceTierPolicy?: unknown }).codexServiceTierPolicy) ??
        legacyCodexCatalogSelectionPolicy,
      browserAllowedOrigins:
        normalizeBrowserAllowedOrigins((room as { browserAllowedOrigins?: unknown }).browserAllowedOrigins) ??
        defaultBrowserAllowedOrigins,
      browserProfilePersistent:
        typeof (room as { browserProfilePersistent?: unknown }).browserProfilePersistent === "boolean"
          ? (room as { browserProfilePersistent: boolean }).browserProfilePersistent
          : defaultBrowserProfilePersistent,
      unread,
      archivedAt,
      deletedAt
    };
  }

  function applyStoredTeamMembers(item: unknown) {
    if (!isRecord(item)) return;
    const teamId = normalizeRelayId(item.teamId, options.maxTeamIdChars);
    if (!teamId || !store.teams.has(teamId)) return;
    const members = new Map<string, TeamMemberRecord>();
    for (const member of storedArray(item.members)) {
      if (!isRecord(member)) continue;
      const userId = normalizeMetadataText(member.userId, options.maxUserIdChars);
      if (!userId) continue;
      members.set(userId, {
        teamId,
        userId,
        role: normalizeTeamRole(member.role),
        joinedAt:
          typeof member.joinedAt === "string" && !Number.isNaN(Date.parse(member.joinedAt))
            ? member.joinedAt
            : new Date().toISOString()
      });
    }
    for (const userId of storedArray(item.userIds)) {
      const normalizedUserId = normalizeMetadataText(userId, options.maxUserIdChars);
      if (normalizedUserId && !members.has(normalizedUserId)) {
        members.set(normalizedUserId, {
          teamId,
          userId: normalizedUserId,
          role: "member",
          joinedAt: new Date().toISOString()
        });
      }
    }
    if (members.size === 0) return;
    store.teamMembers.set(teamId, members);
    const team = store.teams.get(teamId);
    if (team && team.members < members.size) store.teams.set(teamId, { ...team, members: members.size });
  }

  return {
    isExpiredInvite,
    isExpiredAttachmentBlob,
    applyStoredRelayState(stored) {
      for (const team of storedArray(stored.teams)) {
        const normalized = normalizeTeam(team);
        if (normalized) store.teams.set(normalized.id, normalized);
      }
      for (const room of storedArray(stored.rooms)) {
        const normalized = normalizeRoom(room);
        if (normalized) store.rooms.set(normalized.id, normalized);
      }
      for (const invite of storedArray(stored.invites)) {
        const normalized = normalizeInvite(invite);
        if (normalized && !isExpiredInvite(normalized)) store.invites.set(normalized.id, normalized);
      }
      for (const device of storedArray(stored.devices)) {
        const normalized = normalizeDevice(device);
        if (normalized) store.devices.set(deviceKey(normalized.userId, normalized.deviceId), normalized);
      }
      for (const item of storedArray(stored.teamMembers)) {
        applyStoredTeamMembers(item);
      }
      for (const blob of storedArray(stored.attachmentBlobs)) {
        const normalized = normalizeAttachmentBlob(blob);
        if (normalized && !isExpiredAttachmentBlob(normalized)) store.attachmentBlobs.set(normalized.id, normalized);
      }
      for (const storedSession of storedArray(stored.authSessions)) {
        const normalized = options.normalizeStoredAuthSession(storedSession);
        if (normalized) store.authSessions.set(normalized.sessionId, normalized.session);
      }
      for (const item of storedArray(stored.encryptedBacklog)) {
        const normalized = normalizeStoredBacklog(item);
        if (normalized) store.encryptedBacklog.set(normalized.key, normalized.envelopes);
      }
    },
    pruneExpiredRelayState() {
      for (const [id, session] of store.authSessions.entries()) {
        if (session.expiresAt <= Date.now()) store.authSessions.delete(id);
      }
      for (const [id, invite] of store.invites.entries()) {
        if (isExpiredInvite(invite)) store.invites.delete(id);
      }
      for (const [id, blob] of store.attachmentBlobs.entries()) {
        if (isExpiredAttachmentBlob(blob)) store.attachmentBlobs.delete(id);
      }
      for (const [key, envelopes] of store.encryptedBacklog.entries()) {
        const pruned = options.pruneEncryptedBacklog(envelopes);
        if (pruned.length) {
          store.encryptedBacklog.set(key, pruned);
        } else {
          store.encryptedBacklog.delete(key);
        }
      }
    },
    toStoredRelayState() {
      return {
        version: 1,
        savedAt: new Date().toISOString(),
        teams: Array.from(store.teams.values()),
        rooms: Array.from(store.rooms.values()),
        invites: Array.from(store.invites.values()).filter((invite) => !isExpiredInvite(invite)),
        devices: Array.from(store.devices.values()),
        teamMembers: Array.from(store.teamMembers.entries()).map(([teamId, members]) => ({
          teamId,
          members: Array.from(members.values()),
          userIds: Array.from(members.keys())
        })),
        authSessions: options.storedAuthSessions(store.authSessions),
        attachmentBlobs: Array.from(store.attachmentBlobs.values()).filter((blob) => !isExpiredAttachmentBlob(blob)),
        encryptedBacklog: Array.from(store.encryptedBacklog.entries())
          .map(([key, envelopes]) => ({
            key,
            envelopes: options.pruneEncryptedBacklog(envelopes)
          }))
          .filter((item) => item.envelopes.length > 0)
      };
    }
  };
}

function storedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
