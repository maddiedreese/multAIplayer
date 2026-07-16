import {
  AttachmentBlobRecord,
  DeviceRecord as DeviceRecordSchema,
  InviteRecord,
  InviteJoinRequestRecord,
  InviteResponseRecord,
  KeyPackageRecord,
  MlsRelayMessage,
  RoomRecord as RoomRecordSchema,
  TeamMemberRecord as TeamMemberRecordSchema,
  TeamRecord as TeamRecordSchema,
  type AttachmentBlobRecord as AttachmentBlobRecordType,
  type InviteJoinRequestRecord as InviteJoinRequestRecordType,
  type InviteRecord as InviteRecordType,
  type KeyPackageRecord as KeyPackageRecordType,
  type DeviceRecord,
  type RoomRecord,
  type TeamMemberRecord,
  type TeamRecord
} from "@multaiplayer/protocol";
import { z } from "zod";
import { fingerprintPublicKey, validP256HpkeKey, validP256Spki } from "./http/devices.js";
import { maxCiphertextCharactersForBlob, normalizeMetadataText, normalizeRelayId } from "./limits.js";
import {
  isCanonicalPaddedBase64,
  isStrictExporterCiphertextJson,
  parseStrictDirectedInviteRequestJson
} from "./opaque.js";
import type {
  AcceptedMessageReceipt,
  AccountQuotaRecord,
  AccountRestriction,
  AppliedDeletionLedgerEntry,
  InviteAckReceipt,
  RoomKey
} from "./state.js";
import type { RelayStoreCodecOptions } from "./store-codec.js";

const isoDateTime = z.string().datetime({ offset: true });
const sha256Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const hexDigest = z.string().regex(/^[0-9a-f]{64}$/);

export const StoredInviteAckReceipt = z
  .object({
    inviteId: z.string(),
    requestId: z.string(),
    teamId: z.string(),
    requesterUserId: z.string(),
    requesterDeviceId: z.string(),
    keyPackageHash: sha256Digest,
    status: z.enum(["approved", "denied"]),
    acknowledgedAt: isoDateTime,
    expiresAt: isoDateTime
  })
  .strip();

export const StoredAcceptedMessageReceipt = z
  .object({
    roomKey: z.string(),
    messageId: z.string(),
    messageType: z.enum(["application", "commit"]),
    senderUserId: z.string(),
    senderDeviceId: z.string(),
    parentEpoch: z.number().int().nonnegative(),
    digest: hexDigest,
    acceptedAt: isoDateTime
  })
  .strict();

export const StoredAccountRestriction = z
  .object({
    userId: z.string(),
    reasonCode: z.string().regex(/^[a-z0-9_]{1,64}$/),
    createdAt: isoDateTime,
    expiresAt: isoDateTime.optional()
  })
  .strip();

export const StoredAccountQuotaRecord = z
  .object({
    key: z.string(),
    userId: z.string(),
    quota: z.enum(["daily_team_creations", "daily_room_creations", "attachment_upload_bytes"]),
    used: z.number().int().nonnegative(),
    resetAt: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.key !== `${value.quota}:${value.userId}`) {
      context.addIssue({ code: "custom", path: ["key"], message: "Quota key must bind quota and user." });
    }
  });

export const StoredDeletionLedgerEntry = z
  .object({
    entryId: z.string().min(1).max(512),
    appliedAt: isoDateTime
  })
  .strip();

const StoredTeamMembers = z
  .object({
    teamId: z.string(),
    members: z.array(z.unknown())
  })
  .strict();

const StoredMlsBacklog = z
  .object({
    key: z.string(),
    messages: z.array(z.unknown())
  })
  .strip();

function parseStoredRecord<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createRelayStoreNormalizers(options: RelayStoreCodecOptions) {
  // Persistence is a separate trust boundary from live protocol parsing. Reuse
  // protocol schemas where a stored record has the same shape, then apply
  // store-specific limits, referential checks, and expiry.
  // Non-authoritative rows may return null for documented recovery. Team,
  // device, membership, and MLS backlog restoration are fail-closed because
  // silently repairing or dropping them can change authorization or history.
  const { store } = options;
  const now = options.now ?? Date.now;

  function normalizeTeam(team: unknown): TeamRecord | null {
    const parsed = TeamRecordSchema.strict().safeParse(team);
    return parsed.success ? parsed.data : null;
  }

  function normalizeDevice(device: unknown): DeviceRecord | null {
    const parsed = DeviceRecordSchema.strict().safeParse(device);
    if (!parsed.success) return null;
    const normalized = parsed.data;
    if (
      !validP256Spki(normalized.signaturePublicKey, options.maxPublicKeyJwkChars) ||
      !validP256HpkeKey(normalized.hpkePublicKey, options.maxPublicKeyJwkChars) ||
      normalized.signatureKeyFingerprint !== fingerprintPublicKey(normalized.signaturePublicKey) ||
      normalized.hpkeKeyFingerprint !== fingerprintPublicKey(normalized.hpkePublicKey)
    ) {
      return null;
    }
    return normalized;
  }

  function normalizeRoom(room: unknown): RoomRecord | null {
    const parsed = RoomRecordSchema.strict().safeParse(room);
    if (!parsed.success || !store.teams.has(parsed.data.teamId)) return null;
    if (
      parsed.data.hostStatus === "active" &&
      (!parsed.data.hostUserId || !parsed.data.activeHostDeviceId || parsed.data.acceptedMlsEpoch === undefined)
    )
      return null;
    if (parsed.data.hostStatus === "offline" && parsed.data.activeHostDeviceId) return null;
    return parsed.data;
  }

  function applyStoredTeamMembers(item: unknown): boolean {
    const parsed = parseStoredRecord(StoredTeamMembers, item);
    if (!parsed) return false;
    const teamId = normalizeRelayId(parsed.teamId, options.maxTeamIdChars);
    if (!teamId || !store.teams.has(teamId)) return false;
    const members = new Map<string, TeamMemberRecord>();
    for (const member of parsed.members) {
      if (!addStoredMember(members, teamId, member, options.maxUserIdChars)) return false;
    }
    if (members.size === 0) return true;
    store.teamMembers.set(teamId, members);
    return true;
  }

  function deviceKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  function roomKey(teamId: string, roomId: string): RoomKey {
    return `${teamId}:${roomId}`;
  }

  function isKnownRoom(teamId: string, roomId: string): boolean {
    return store.rooms.get(roomId)?.teamId === teamId;
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
      if (!parsed.success) return null;
      if (parsed.data.teamId !== teamId || parsed.data.roomId !== roomId) return null;
      if (!isCanonicalPaddedBase64(parsed.data.mlsMessage, options.maxMlsMessageChars)) return null;
      if (
        parsed.data.hostTransferAuthorization &&
        (!isCanonicalPaddedBase64(parsed.data.hostTransferAuthorization.signatureDer, 1_400_000) ||
          !isCanonicalPaddedBase64(parsed.data.hostTransferAuthorization.publicKeySpkiDer, 1_400_000))
      )
        return null;
      messages.push(parsed.data);
    }

    const pruned = options.pruneMlsBacklog(messages);
    return { key: roomKey(teamId, roomId), messages: pruned };
  }

  return {
    deviceKey,
    roomKey,
    isKnownRoom,
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

function addStoredMember(
  members: Map<string, TeamMemberRecord>,
  teamId: string,
  value: unknown,
  maxUserIdChars: number
): boolean {
  const parsed = TeamMemberRecordSchema.strict().safeParse(value);
  if (
    !parsed.success ||
    parsed.data.teamId !== teamId ||
    parsed.data.userId.length > maxUserIdChars ||
    members.has(parsed.data.userId)
  )
    return false;
  members.set(parsed.data.userId, parsed.data);
  return true;
}

export function normalizeAccountRestriction(
  value: unknown,
  now: number,
  maxUserIdChars: number
): AccountRestriction | null {
  const parsed = parseStoredRecord(StoredAccountRestriction, value);
  if (!parsed) return null;
  const userId = normalizeMetadataText(parsed.userId, maxUserIdChars);
  if (!userId || (parsed.expiresAt && Date.parse(parsed.expiresAt) <= now)) return null;
  return {
    userId,
    reasonCode: parsed.reasonCode,
    createdAt: parsed.createdAt,
    ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {})
  };
}

export function isExpiredStoredAccountRestriction(value: unknown, now: number): boolean {
  const parsed = StoredAccountRestriction.safeParse(value);
  return parsed.success && parsed.data.expiresAt !== undefined && Date.parse(parsed.data.expiresAt) <= now;
}

export function normalizeAccountQuotaRecord(value: unknown, now: number): AccountQuotaRecord | null {
  const parsed = parseStoredRecord(StoredAccountQuotaRecord, value);
  return parsed && parsed.resetAt > now ? parsed : null;
}

export function isExpiredStoredAccountQuotaRecord(value: unknown, now: number): boolean {
  const parsed = StoredAccountQuotaRecord.safeParse(value);
  return parsed.success && parsed.data.resetAt <= now;
}

export function isExpiredStoredAcceptedMessageReceipt(value: unknown, now: number): boolean {
  const parsed = StoredAcceptedMessageReceipt.safeParse(value);
  return parsed.success && Date.parse(parsed.data.acceptedAt) < now - 180 * 24 * 60 * 60 * 1000;
}

export function normalizeDeletionLedgerEntry(value: unknown): AppliedDeletionLedgerEntry | null {
  return parseStoredRecord(StoredDeletionLedgerEntry, value);
}
