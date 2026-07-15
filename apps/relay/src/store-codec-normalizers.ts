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
  defaultApprovalDelegationPolicy,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultRoomMode,
  isRecord,
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
import {
  maxCiphertextCharactersForBlob,
  isApprovalDelegationPolicy,
  isApprovalPolicy,
  isRoomMode,
  normalizeBrowserAllowedOrigins,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRelayId,
  normalizeTeamRole
} from "./limits.js";
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
  RelayStore,
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
  .strip();

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
  .strip()
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
    members: z.array(z.unknown()).optional(),
    userIds: z.array(z.unknown()).optional()
  })
  .strip();

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
  // store-specific limits, referential checks, expiry, and legacy defaults.
  // These normalizers deliberately return null so one bad row can be dropped
  // without turning a recoverable store into a relay startup failure.
  const { store } = options;
  const now = options.now ?? Date.now;

  function normalizeTeam(team: unknown): TeamRecord | null {
    if (!isRecord(team)) return null;
    const id = normalizeRelayId(team.id, options.maxTeamIdChars);
    const name = normalizeMetadataText(team.name, options.maxTeamNameChars);
    if (!id || !name) return null;
    const candidate = {
      id,
      name,
      members: validCounter(team.members) ? team.members : 0,
      archivedAt: validDate(team.archivedAt),
      deletedAt: validDate(team.deletedAt)
    };
    const parsed = TeamRecordSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  function normalizeDevice(device: unknown): DeviceRecord | null {
    const parsed = DeviceRecordSchema.safeParse(device);
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
    if (!isRecord(room)) return null;
    const id = normalizeRelayId(room.id, options.maxRoomIdChars);
    const teamId = normalizeRelayId(room.teamId, options.maxTeamIdChars);
    if (!id || !teamId || !store.teams.has(teamId)) return null;
    const hostStatus = normalizeHostStatus(room.hostStatus);
    const hostUserId = normalizeOptionalMetadataText(room.hostUserId, options.maxUserIdChars) || undefined;
    const candidate = {
      id,
      teamId,
      acceptedMlsEpoch: normalizeAcceptedEpoch(room.acceptedMlsEpoch, hostStatus),
      name: normalizeMetadataText(room.name, options.maxRoomNameChars) ?? "Untitled room",
      host: hostUserId ? (normalizeMetadataText(room.host, options.maxHostNameChars) ?? "Reserved host") : "No host",
      hostUserId,
      activeHostDeviceId:
        hostStatus === "offline"
          ? undefined
          : normalizeOptionalMetadataText(room.activeHostDeviceId, options.maxDeviceIdChars) || undefined,
      hostStatus,
      approvalPolicy:
        typeof room.approvalPolicy === "string" && isApprovalPolicy(room.approvalPolicy)
          ? room.approvalPolicy
          : "ask_every_turn",
      approvalDelegationPolicy:
        typeof room.approvalDelegationPolicy === "string" && isApprovalDelegationPolicy(room.approvalDelegationPolicy)
          ? room.approvalDelegationPolicy
          : defaultApprovalDelegationPolicy,
      trustedApproverUserIds: normalizeTrustedApprovers(room.trustedApproverUserIds, options.maxUserIdChars),
      mode: isRoomMode(room.mode) ? room.mode : defaultRoomMode,
      browserAllowedOrigins: normalizeBrowserAllowedOrigins(room.browserAllowedOrigins) ?? defaultBrowserAllowedOrigins,
      browserProfilePersistent:
        typeof room.browserProfilePersistent === "boolean"
          ? room.browserProfilePersistent
          : defaultBrowserProfilePersistent,
      unread: validCounter(room.unread) ? room.unread : 0,
      archivedAt: validDate(room.archivedAt),
      deletedAt: validDate(room.deletedAt)
    };
    const parsed = RoomRecordSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  function applyStoredTeamMembers(item: unknown): void {
    const parsed = parseStoredRecord(StoredTeamMembers, item);
    if (!parsed) return;
    const teamId = normalizeRelayId(parsed.teamId, options.maxTeamIdChars);
    if (!teamId || !store.teams.has(teamId)) return;
    const members = new Map<string, TeamMemberRecord>();
    for (const member of parsed.members ?? []) addStoredMember(members, teamId, member, options.maxUserIdChars, now());
    for (const userId of parsed.userIds ?? []) addLegacyMember(members, teamId, userId, options.maxUserIdChars, now());
    if (members.size === 0) return;
    store.teamMembers.set(teamId, members);
    const team = store.teams.get(teamId);
    if (team && team.members < members.size) store.teams.set(teamId, { ...team, members: members.size });
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
  maxUserIdChars: number,
  now: number
): void {
  if (!isRecord(value)) return;
  const userId = normalizeMetadataText(value.userId, maxUserIdChars);
  if (!userId) return;
  const parsed = TeamMemberRecordSchema.safeParse({
    teamId,
    userId,
    role: normalizeTeamRole(value.role),
    joinedAt: validDate(value.joinedAt) ?? new Date(now).toISOString()
  });
  if (parsed.success) members.set(userId, parsed.data);
}

function addLegacyMember(
  members: Map<string, TeamMemberRecord>,
  teamId: string,
  value: unknown,
  maxUserIdChars: number,
  now: number
): void {
  const userId = normalizeMetadataText(value, maxUserIdChars);
  if (!userId || members.has(userId)) return;
  members.set(userId, { teamId, userId, role: "member", joinedAt: new Date(now).toISOString() });
}

function normalizeTrustedApprovers(value: unknown, maxUserIdChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeMetadataText(item, maxUserIdChars))
    .filter((item): item is string => Boolean(item))
    .slice(0, 50);
}

function normalizeHostStatus(value: unknown): RoomRecord["hostStatus"] {
  return value === "active" || value === "handoff" || value === "offline" ? value : "offline";
}

function normalizeAcceptedEpoch(value: unknown, hostStatus: RoomRecord["hostStatus"]): number | undefined {
  return validCounter(value) ? value : hostStatus === "active" ? 0 : undefined;
}

function validCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validDate(value: unknown): string | undefined {
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
  return { ...parsed, userId };
}

export function normalizeAccountQuotaRecord(value: unknown, now: number): AccountQuotaRecord | null {
  const parsed = parseStoredRecord(StoredAccountQuotaRecord, value);
  return parsed && parsed.resetAt > now ? parsed : null;
}

export function normalizeDeletionLedgerEntry(value: unknown): AppliedDeletionLedgerEntry | null {
  return parseStoredRecord(StoredDeletionLedgerEntry, value);
}

export function applyStoredAccountQuotaRecords(store: RelayStore, value: unknown, now: number): void {
  for (const item of storedArray(value)) {
    const quota = normalizeAccountQuotaRecord(item, now);
    if (quota) store.accountQuotaRecords.set(quota.key, quota);
  }
}

function storedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
