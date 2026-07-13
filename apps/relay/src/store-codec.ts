import {
  AttachmentBlobRecord,
  InviteRecord,
  InviteJoinRequestRecord,
  InviteResponseRecord,
  KeyPackageRecord,
  MlsRelayMessage,
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
  type KeyPackageRecord as KeyPackageRecordType,
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
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRelayId,
  normalizeRoomProjectPath,
  normalizeTeamRole
} from "./limits.js";
import {
  isCanonicalPaddedBase64,
  isStrictExporterCiphertextJson,
  parseStrictDirectedInviteRequestJson
} from "./opaque.js";
import type { AcceptedMessageReceipt, AuthSession, InviteAckReceipt, RelayStore, RoomKey } from "./state.js";
import { fingerprintPublicKey, validP256HpkeKey, validP256Spki } from "./http/devices.js";

export interface StoredRelayState {
  version: 1;
  savedAt: string;
  teams: TeamRecord[];
  rooms: RoomRecord[];
  invites: InviteRecordType[];
  devices?: DeviceRecord[];
  keyPackages?: KeyPackageRecordType[];
  inviteRequests?: unknown[];
  inviteResponses?: unknown[];
  inviteAckReceipts?: unknown[];
  acceptedMessageReceipts?: unknown[];
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
  mlsBacklog: Array<{
    key: RoomKey;
    messages: MlsRelayMessage[];
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
  maxHostNameChars: number;
  maxMlsMessageChars: number;
  maxPublicKeyFingerprintChars: number;
  maxPublicKeyJwkChars: number;
  maxRoomIdChars: number;
  maxRoomNameChars: number;
  maxRoomProjectPathChars: number;
  maxTeamIdChars: number;
  maxTeamNameChars: number;
  maxUserIdChars: number;
  normalizeStoredAuthSession: (stored: unknown) => NormalizedStoredAuthSession | null;
  pruneMlsBacklog: (messages: MlsRelayMessage[]) => MlsRelayMessage[];
  storedAuthSessions: (authSessions: Map<string, AuthSession>) => StoredAuthSession[];
  now?: () => number;
}): RelayStoreCodec {
  const { store } = options;
  const now = options.now ?? Date.now;

  function deviceKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  function roomKey(teamId: string, roomId: string): RoomKey {
    return `${teamId}:${roomId}`;
  }

  function isKnownRoom(teamId: string, roomId: string): boolean {
    return store.rooms.get(roomId)?.teamId === teamId;
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
    const userId = normalizeMetadataText(device.userId, options.maxUserIdChars);
    const deviceId = normalizeMetadataText(device.deviceId, options.maxDeviceIdChars);
    const displayName = normalizeMetadataText(device.displayName, options.maxDisplayNameChars);
    const signaturePublicKey = normalizeMetadataText(device.signaturePublicKey, options.maxPublicKeyJwkChars);
    const hpkePublicKey = normalizeMetadataText(device.hpkePublicKey, options.maxPublicKeyJwkChars);
    const signatureKeyFingerprint = normalizeMetadataText(
      device.signatureKeyFingerprint,
      options.maxPublicKeyFingerprintChars
    );
    const hpkeKeyFingerprint = normalizeMetadataText(device.hpkeKeyFingerprint, options.maxPublicKeyFingerprintChars);
    if (
      !userId ||
      !deviceId ||
      !displayName ||
      !signaturePublicKey ||
      !hpkePublicKey ||
      !signatureKeyFingerprint ||
      !hpkeKeyFingerprint
    )
      return null;
    if (
      !validP256Spki(signaturePublicKey, options.maxPublicKeyJwkChars) ||
      !validP256HpkeKey(hpkePublicKey, options.maxPublicKeyJwkChars) ||
      signatureKeyFingerprint !== fingerprintPublicKey(signaturePublicKey) ||
      hpkeKeyFingerprint !== fingerprintPublicKey(hpkePublicKey)
    )
      return null;
    if (typeof device.registeredAt !== "string" || typeof device.lastSeenAt !== "string") return null;
    return {
      userId,
      deviceId,
      displayName,
      signaturePublicKey,
      signatureKeyFingerprint,
      hpkePublicKey,
      hpkeKeyFingerprint,
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

  function normalizeKeyPackage(value: unknown): KeyPackageRecordType | null {
    const parsed = KeyPackageRecord.safeParse(value);
    if (!parsed.success || !isCanonicalPaddedBase64(parsed.data.keyPackage, 32_768)) return null;
    return store.getDevice(parsed.data.userId, parsed.data.deviceId) ? parsed.data : null;
  }

  function normalizeRequest(value: unknown) {
    const parsed = InviteJoinRequestRecord.safeParse(value);
    if (!parsed.success) return null;
    const directed = parseStrictDirectedInviteRequestJson(parsed.data.sealedRequest, 1_400_000);
    const invite = store.getInvite(parsed.data.inviteId);
    const room = invite && store.getRoom(invite.roomId);
    return directed &&
      invite &&
      room &&
      directed.binding.inviteId === invite.id &&
      directed.binding.teamId === invite.teamId &&
      directed.binding.roomId === invite.roomId &&
      directed.binding.keyEpoch === (room.acceptedMlsEpoch ?? 0) &&
      directed.binding.keyPackageHash === parsed.data.keyPackageHash &&
      directed.binding.requestId === parsed.data.requestId &&
      directed.binding.requesterUserId === parsed.data.requesterUserId &&
      directed.binding.requesterDeviceId === parsed.data.requesterDeviceId &&
      directed.binding.hostUserId === room.hostUserId &&
      directed.binding.hostDeviceId === room.activeHostDeviceId &&
      directed.binding.expiresAt === invite.expiresAt
      ? parsed.data
      : null;
  }
  function normalizeWelcome(value: unknown) {
    const parsed = InviteResponseRecord.safeParse(value);
    if (!parsed.success) return null;
    const response = parsed.data;
    const binding = response.responseBinding;
    const invite = store.getInvite(response.inviteId);
    const linked =
      binding.inviteId === response.inviteId &&
      binding.requestId === response.requestId &&
      binding.requesterUserId === response.requesterUserId &&
      binding.requesterDeviceId === response.requesterDeviceId &&
      binding.keyPackageHash === response.keyPackageHash &&
      binding.status === response.status &&
      invite?.teamId === binding.teamId &&
      invite.roomId === binding.roomId &&
      (response.status !== "approved" ||
        (invite.approvedUserId === response.requesterUserId &&
          invite.approvedDeviceId === response.requesterDeviceId &&
          invite.keyPackageHash === response.keyPackageHash));
    return linked &&
      isCanonicalPaddedBase64(parsed.data.responseMac, 128) &&
      (parsed.data.welcome === undefined || isCanonicalPaddedBase64(parsed.data.welcome, 1_400_000))
      ? parsed.data
      : null;
  }

  function normalizeInviteAckReceipt(value: unknown): InviteAckReceipt | null {
    if (!isRecord(value)) return null;
    const fields = [
      normalizeRelayId(value.inviteId, options.maxEnvelopeIdChars),
      normalizeRelayId(value.requestId, options.maxEnvelopeIdChars),
      normalizeRelayId(value.teamId, options.maxTeamIdChars),
      normalizeMetadataText(value.requesterUserId, options.maxUserIdChars),
      normalizeMetadataText(value.requesterDeviceId, options.maxDeviceIdChars)
    ];
    if (
      fields.some((field) => !field) ||
      typeof value.keyPackageHash !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(value.keyPackageHash)
    )
      return null;
    if (
      typeof value.acknowledgedAt !== "string" ||
      typeof value.expiresAt !== "string" ||
      Number.isNaN(Date.parse(value.acknowledgedAt)) ||
      Date.parse(value.expiresAt) <= now()
    )
      return null;
    const [inviteId, requestId, teamId, requesterUserId, requesterDeviceId] = fields as string[];
    if (value.status !== "approved" && value.status !== "denied") return null;
    const status = value.status;
    if (!store.hasTeam(teamId) || (status === "approved" && !store.hasTeamMember(teamId, requesterUserId))) return null;
    return {
      inviteId,
      requestId,
      teamId,
      requesterUserId,
      requesterDeviceId,
      keyPackageHash: value.keyPackageHash,
      status,
      acknowledgedAt: value.acknowledgedAt,
      expiresAt: value.expiresAt
    };
  }

  function normalizeAcceptedMessageReceipt(value: unknown): AcceptedMessageReceipt | null {
    if (!isRecord(value) || typeof value.roomKey !== "string" || typeof value.digest !== "string") return null;
    const [teamId, roomId, extra] = value.roomKey.split(":");
    const messageId = normalizeRelayId(value.messageId, options.maxEnvelopeIdChars);
    if (
      extra !== undefined ||
      !teamId ||
      !roomId ||
      !isKnownRoom(teamId, roomId) ||
      !messageId ||
      !/^[0-9a-f]{64}$/.test(value.digest)
    )
      return null;
    if (
      typeof value.parentEpoch !== "number" ||
      !Number.isSafeInteger(value.parentEpoch) ||
      value.parentEpoch < 0 ||
      typeof value.acceptedAt !== "string"
    )
      return null;
    const acceptedAt = Date.parse(value.acceptedAt);
    if (!Number.isFinite(acceptedAt) || acceptedAt < now() - 180 * 24 * 60 * 60 * 1000) return null;
    if (value.messageType !== "application" && value.messageType !== "commit") return null;
    const messageType = value.messageType;
    const senderUserId = normalizeMetadataText(value.senderUserId, options.maxUserIdChars);
    const senderDeviceId = normalizeMetadataText(value.senderDeviceId, options.maxDeviceIdChars);
    if (!senderUserId || !senderDeviceId) return null;
    return {
      roomKey: value.roomKey as RoomKey,
      messageId,
      messageType,
      senderUserId,
      senderDeviceId,
      parentEpoch: value.parentEpoch,
      digest: value.digest,
      acceptedAt: value.acceptedAt
    };
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
    if (parsed.data.sealedBlob.length > maxCiphertextCharactersForBlob(options.attachmentBlobMaxBytes)) return null;
    if (
      !isStrictExporterCiphertextJson(
        parsed.data.sealedBlob,
        maxCiphertextCharactersForBlob(options.attachmentBlobMaxBytes)
      )
    )
      return null;
    if (Number.isNaN(Date.parse(parsed.data.createdAt))) return null;
    if (parsed.data.expiresAt && Number.isNaN(Date.parse(parsed.data.expiresAt))) return null;
    return { ...parsed.data, id, name, type };
  }

  function isExpiredInvite(invite: InviteRecordType): boolean {
    return Boolean(invite.expiresAt && Date.parse(invite.expiresAt) < now());
  }

  function isExpiredAttachmentBlob(blob: AttachmentBlobRecordType): boolean {
    return Boolean(blob.expiresAt && Date.parse(blob.expiresAt) < now());
  }

  function normalizeStoredBacklog(item: unknown): { key: RoomKey; messages: MlsRelayMessage[] } | null {
    if (!isRecord(item) || typeof item.key !== "string" || !Array.isArray(item.messages)) return null;
    const [teamId, roomId, extra] = item.key.split(":");
    if (extra !== undefined || !teamId || !roomId || !isKnownRoom(teamId, roomId)) return null;

    const messages: MlsRelayMessage[] = [];
    for (const candidate of item.messages) {
      const parsed = MlsRelayMessage.safeParse(candidate);
      if (!parsed.success) continue;
      if (parsed.data.teamId !== teamId || parsed.data.roomId !== roomId) continue;
      if (!isCanonicalPaddedBase64(parsed.data.mlsMessage, options.maxMlsMessageChars)) continue;
      if (
        parsed.data.hostTransferAuthorization &&
        (!isCanonicalPaddedBase64(parsed.data.hostTransferAuthorization.signatureDer, 1_400_000) ||
          !isCanonicalPaddedBase64(parsed.data.hostTransferAuthorization.publicKeySpkiDer, 1_400_000))
      )
        continue;
      messages.push(parsed.data);
    }

    const pruned = options.pruneMlsBacklog(messages);
    return pruned.length ? { key: roomKey(teamId, roomId), messages: pruned } : null;
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
    const normalizedHostUserId = normalizeOptionalMetadataText(room.hostUserId, options.maxUserIdChars) || undefined;
    const hostUserId = normalizedHostUserId;
    const host = hostUserId
      ? (normalizeMetadataText(room.host, options.maxHostNameChars) ?? "Reserved host")
      : "No host";
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
      acceptedMlsEpoch:
        typeof room.acceptedMlsEpoch === "number" &&
        Number.isSafeInteger(room.acceptedMlsEpoch) &&
        room.acceptedMlsEpoch >= 0
          ? room.acceptedMlsEpoch
          : hostStatus === "active"
            ? 0
            : undefined,
      name,
      projectPath: normalizeProjectPath(room.projectPath) ?? "/",
      host,
      hostUserId,
      activeHostDeviceId:
        hostStatus === "offline"
          ? undefined
          : normalizeOptionalMetadataText(room.activeHostDeviceId, options.maxDeviceIdChars) || undefined,
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
            : new Date(now()).toISOString()
      });
    }
    for (const userId of storedArray(item.userIds)) {
      const normalizedUserId = normalizeMetadataText(userId, options.maxUserIdChars);
      if (normalizedUserId && !members.has(normalizedUserId)) {
        members.set(normalizedUserId, {
          teamId,
          userId: normalizedUserId,
          role: "member",
          joinedAt: new Date(now()).toISOString()
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
      for (const keyPackage of storedArray(stored.keyPackages)) {
        const normalized = normalizeKeyPackage(keyPackage);
        if (normalized && !store.keyPackages.has(normalized.id)) store.setKeyPackage(normalized);
      }
      for (const request of storedArray(stored.inviteRequests)) {
        const parsed = normalizeRequest(request);
        if (parsed && !store.inviteRequests.has(parsed.requestId)) store.inviteRequests.set(parsed.requestId, parsed);
      }
      for (const response of storedArray(stored.inviteResponses)) {
        const parsed = normalizeWelcome(response);
        if (parsed && !store.inviteResponses.has(parsed.requestId)) store.inviteResponses.set(parsed.requestId, parsed);
      }
      for (const item of storedArray(stored.teamMembers)) {
        applyStoredTeamMembers(item);
      }
      for (const receipt of storedArray(stored.inviteAckReceipts)) {
        const normalized = normalizeInviteAckReceipt(receipt);
        if (normalized) store.inviteAckReceipts.set(normalized.requestId, normalized);
      }
      for (const receipt of storedArray(stored.acceptedMessageReceipts)) {
        const normalized = normalizeAcceptedMessageReceipt(receipt);
        if (normalized) store.acceptedMessageReceipts.set(`${normalized.roomKey}\0${normalized.messageId}`, normalized);
      }
      for (const blob of storedArray(stored.attachmentBlobs)) {
        const normalized = normalizeAttachmentBlob(blob);
        if (normalized && !isExpiredAttachmentBlob(normalized)) store.attachmentBlobs.set(normalized.id, normalized);
      }
      for (const storedSession of storedArray(stored.authSessions)) {
        const normalized = options.normalizeStoredAuthSession(storedSession);
        if (normalized) store.authSessions.set(normalized.sessionId, normalized.session);
      }
      for (const item of storedArray(stored.mlsBacklog)) {
        const normalized = normalizeStoredBacklog(item);
        if (normalized) store.mlsBacklog.set(normalized.key, normalized.messages);
      }
    },
    pruneExpiredRelayState() {
      for (const [id, session] of store.authSessions.entries()) {
        if (session.expiresAt <= now()) store.authSessions.delete(id);
      }
      for (const [id, invite] of store.invites.entries()) {
        if (isExpiredInvite(invite)) {
          store.invites.delete(id);
          for (const [requestId, request] of store.inviteRequests) {
            if (request.inviteId === id) store.inviteRequests.delete(requestId);
          }
          for (const [requestId, response] of store.inviteResponses) {
            if (response.inviteId === id) store.inviteResponses.delete(requestId);
          }
        }
      }
      for (const [id, receipt] of store.inviteAckReceipts) {
        if (Date.parse(receipt.expiresAt) <= now()) store.inviteAckReceipts.delete(id);
      }
      const ackReceipts = Array.from(store.inviteAckReceipts.entries()).sort(
        (left, right) => Date.parse(left[1].acknowledgedAt) - Date.parse(right[1].acknowledgedAt)
      );
      for (const [id] of ackReceipts.slice(0, Math.max(0, ackReceipts.length - 4096)))
        store.inviteAckReceipts.delete(id);
      for (const [id, receipt] of store.acceptedMessageReceipts) {
        if (Date.parse(receipt.acceptedAt) < now() - 180 * 24 * 60 * 60 * 1000)
          store.acceptedMessageReceipts.delete(id);
      }
      const receiptPools = new Map<string, Array<[string, AcceptedMessageReceipt]>>();
      for (const entry of store.acceptedMessageReceipts) {
        const [, receipt] = entry;
        const pool =
          receipt.messageType === "commit"
            ? `${receipt.roomKey}\0commit`
            : `${receipt.roomKey}\0application\0${receipt.senderUserId}`;
        const receipts = receiptPools.get(pool) ?? [];
        receipts.push(entry);
        receiptPools.set(pool, receipts);
      }
      for (const receipts of receiptPools.values()) {
        receipts.sort((left, right) => Date.parse(left[1].acceptedAt) - Date.parse(right[1].acceptedAt));
        for (const [id] of receipts.slice(0, Math.max(0, receipts.length - 4096)))
          store.acceptedMessageReceipts.delete(id);
      }
      for (const [id, blob] of store.attachmentBlobs.entries()) {
        if (isExpiredAttachmentBlob(blob)) store.attachmentBlobs.delete(id);
      }
      for (const [key, messages] of store.mlsBacklog.entries()) {
        const pruned = options.pruneMlsBacklog(messages);
        if (pruned.length) {
          store.mlsBacklog.set(key, pruned);
        } else {
          store.mlsBacklog.delete(key);
        }
      }
    },
    toStoredRelayState() {
      return {
        version: 1,
        savedAt: new Date(now()).toISOString(),
        teams: Array.from(store.teams.values()),
        rooms: Array.from(store.rooms.values()),
        invites: Array.from(store.invites.values()).filter((invite) => !isExpiredInvite(invite)),
        devices: Array.from(store.devices.values()),
        keyPackages: Array.from(store.keyPackages.values()),
        inviteRequests: Array.from(store.inviteRequests.values()),
        inviteResponses: Array.from(store.inviteResponses.values()),
        inviteAckReceipts: Array.from(store.inviteAckReceipts.values()),
        acceptedMessageReceipts: Array.from(store.acceptedMessageReceipts.values()),
        teamMembers: Array.from(store.teamMembers.entries()).map(([teamId, members]) => ({
          teamId,
          members: Array.from(members.values()),
          userIds: Array.from(members.keys())
        })),
        authSessions: options.storedAuthSessions(store.authSessions),
        attachmentBlobs: Array.from(store.attachmentBlobs.values()).filter((blob) => !isExpiredAttachmentBlob(blob)),
        mlsBacklog: Array.from(store.mlsBacklog.entries())
          .map(([key, messages]) => ({
            key,
            messages: options.pruneMlsBacklog(messages)
          }))
          .filter((item) => item.messages.length > 0)
      };
    }
  };
}

function storedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
