import {
  AttachmentBlobRecord,
  InviteRecord,
  InviteJoinRequestRecord,
  InviteResponseRecord,
  KeyPackageRecord,
  MlsRelayMessage,
  type AttachmentBlobRecord as AttachmentBlobRecordType,
  type InviteJoinRequestRecord as InviteJoinRequestRecordType,
  type InviteRecord as InviteRecordType,
  type KeyPackageRecord as KeyPackageRecordType,
  type RoomRecord
} from "@multaiplayer/protocol";
import {
  maxCiphertextCharactersForBlob,
  normalizeCodexModel,
  normalizeMetadataText,
  normalizeRelayId,
  normalizeRoomProjectPath
} from "./limits.js";
import {
  isCanonicalPaddedBase64,
  isStrictExporterCiphertextJson,
  parseStrictDirectedInviteRequestJson
} from "./opaque.js";
import type { AcceptedMessageReceipt, InviteAckReceipt, RoomKey } from "./state.js";
import type { RelayStoreCodecOptions } from "./store-codec.js";
import { createStoredEntityNormalizers } from "./store-codec-entity-normalizers.js";
import {
  parseStoredRecord,
  StoredAcceptedMessageReceipt,
  StoredInviteAckReceipt,
  StoredMlsBacklog
} from "./store-codec-schemas.js";

export function createRelayStoreNormalizers(options: RelayStoreCodecOptions) {
  // Persistence is a separate trust boundary from live protocol parsing. Reuse
  // protocol schemas where a stored record has the same shape, then apply
  // store-specific limits, referential checks, expiry, and legacy defaults.
  // These normalizers deliberately return null so one bad row can be dropped
  // without turning a recoverable store into a relay startup failure.
  const { store } = options;
  const now = options.now ?? Date.now;
  const { normalizeTeam, normalizeDevice, normalizeRoom, applyStoredTeamMembers } =
    createStoredEntityNormalizers(options);

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

  function normalizeInvite(invite: unknown): InviteRecordType | null {
    const parsed = InviteRecord.safeParse(invite);
    if (!parsed.success) return null;
    const id = normalizeRelayId(parsed.data.id, options.maxEnvelopeIdChars);
    if (!id) return null;
    if (!store.teams.has(parsed.data.teamId)) return null;
    if (!store.rooms.has(parsed.data.roomId) || store.rooms.get(parsed.data.roomId)?.teamId !== parsed.data.teamId)
      return null;
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
    if (!directed || !invite || !room) return null;
    return requestBindingMatches(parsed.data, directed, invite, room) ? parsed.data : null;
  }

  function requestBindingMatches(
    request: InviteJoinRequestRecordType,
    directed: NonNullable<ReturnType<typeof parseStrictDirectedInviteRequestJson>>,
    invite: InviteRecordType,
    room: RoomRecord
  ): boolean {
    return (
      requestEpochIsRecoverable(request, directed.binding.keyEpoch, invite, room.acceptedMlsEpoch ?? 0) &&
      directed.binding.inviteId === invite.id &&
      directed.binding.teamId === invite.teamId &&
      directed.binding.roomId === invite.roomId &&
      directed.binding.keyPackageHash === request.keyPackageHash &&
      directed.binding.requestId === request.requestId &&
      directed.binding.requesterUserId === request.requesterUserId &&
      directed.binding.requesterDeviceId === request.requesterDeviceId &&
      directed.binding.hostUserId === room.hostUserId &&
      directed.binding.hostDeviceId === room.activeHostDeviceId &&
      directed.binding.expiresAt === invite.expiresAt
    );
  }

  function requestEpochIsRecoverable(
    request: InviteJoinRequestRecordType,
    requestEpoch: number,
    invite: InviteRecordType,
    acceptedEpoch: number
  ): boolean {
    if (requestEpoch === acceptedEpoch) return true;
    return (
      acceptedEpoch > 0 &&
      requestEpoch === acceptedEpoch - 1 &&
      invite.approvedUserId === request.requesterUserId &&
      invite.approvedDeviceId === request.requesterDeviceId &&
      invite.keyPackageHash === request.keyPackageHash
    );
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
    const parsed = parseStoredRecord(StoredInviteAckReceipt, value);
    if (!parsed) return null;
    const fields = [
      normalizeRelayId(parsed.inviteId, options.maxEnvelopeIdChars),
      normalizeRelayId(parsed.requestId, options.maxEnvelopeIdChars),
      normalizeRelayId(parsed.teamId, options.maxTeamIdChars),
      normalizeMetadataText(parsed.requesterUserId, options.maxUserIdChars),
      normalizeMetadataText(parsed.requesterDeviceId, options.maxDeviceIdChars)
    ];
    if (fields.some((field) => !field) || Date.parse(parsed.expiresAt) <= now()) return null;
    const [inviteId, requestId, teamId, requesterUserId, requesterDeviceId] = fields;
    if (!inviteId || !requestId || !teamId || !requesterUserId || !requesterDeviceId) return null;
    const status = parsed.status;
    if (!store.hasTeam(teamId) || (status === "approved" && !store.hasTeamMember(teamId, requesterUserId))) return null;
    return {
      inviteId,
      requestId,
      teamId,
      requesterUserId,
      requesterDeviceId,
      keyPackageHash: parsed.keyPackageHash,
      status,
      acknowledgedAt: parsed.acknowledgedAt,
      expiresAt: parsed.expiresAt
    };
  }

  function normalizeAcceptedMessageReceipt(value: unknown): AcceptedMessageReceipt | null {
    const parsed = parseStoredRecord(StoredAcceptedMessageReceipt, value);
    if (!parsed) return null;
    const [teamId, roomId, extra] = parsed.roomKey.split(":");
    const messageId = normalizeRelayId(parsed.messageId, options.maxEnvelopeIdChars);
    if (extra !== undefined || !teamId || !roomId || !isKnownRoom(teamId, roomId) || !messageId) return null;
    const acceptedAt = Date.parse(parsed.acceptedAt);
    if (!Number.isFinite(acceptedAt) || acceptedAt < now() - 180 * 24 * 60 * 60 * 1000) return null;
    const senderUserId = normalizeMetadataText(parsed.senderUserId, options.maxUserIdChars);
    const senderDeviceId = normalizeMetadataText(parsed.senderDeviceId, options.maxDeviceIdChars);
    if (!senderUserId || !senderDeviceId) return null;
    return {
      roomKey: parsed.roomKey as RoomKey,
      messageId,
      messageType: parsed.messageType,
      senderUserId,
      senderDeviceId,
      parentEpoch: parsed.parentEpoch,
      digest: parsed.digest,
      acceptedAt: parsed.acceptedAt
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
    return { ...parsed.data, id, name, type };
  }

  function isExpiredInvite(invite: InviteRecordType): boolean {
    return Boolean(invite.expiresAt && Date.parse(invite.expiresAt) < now());
  }

  function isExpiredAttachmentBlob(blob: AttachmentBlobRecordType): boolean {
    return Boolean(blob.expiresAt && Date.parse(blob.expiresAt) < now());
  }

  function normalizeStoredBacklog(item: unknown): { key: RoomKey; messages: MlsRelayMessage[] } | null {
    const parsedBacklog = parseStoredRecord(StoredMlsBacklog, item);
    if (!parsedBacklog) return null;
    const [teamId, roomId, extra] = parsedBacklog.key.split(":");
    if (extra !== undefined || !teamId || !roomId || !isKnownRoom(teamId, roomId)) return null;

    const messages: MlsRelayMessage[] = [];
    for (const candidate of parsedBacklog.messages) {
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

  return {
    deviceKey,
    roomKey,
    isKnownRoom,
    normalizeProjectPath,
    normalizeModel,
    normalizeTeam,
    normalizeDevice,
    normalizeInvite,
    normalizeKeyPackage,
    normalizeRequest,
    normalizeWelcome,
    normalizeInviteAckReceipt,
    normalizeAcceptedMessageReceipt,
    normalizeAttachmentBlob,
    isExpiredInvite,
    isExpiredAttachmentBlob,
    normalizeStoredBacklog,
    normalizeRoom,
    applyStoredTeamMembers
  };
}
