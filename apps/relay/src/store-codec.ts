import {
  isRecord,
  type MlsRelayMessage,
  type AttachmentBlobRecord as AttachmentBlobRecordType,
  type DeviceRecord,
  type InviteRecord as InviteRecordType,
  type InviteJoinRequestRecord,
  type InviteResponseRecord,
  type KeyPackageRecord as KeyPackageRecordType,
  type RoomRecord,
  type TeamMemberRecord,
  type TeamRecord
} from "@multaiplayer/protocol";
import type { NormalizedStoredAuthSession, StoredAuthSession } from "./auth/session.js";
import type {
  AcceptedMessageReceipt,
  AccountQuotaRecord,
  AccountRestriction,
  AuthSession,
  ConsumedKeyPackageRecord,
  InviteAckReceipt,
  RelayStore,
  RoomKey
} from "./state.js";
import type { StoredRelayMutation } from "./persistence-types.js";
import { createStoredRelayMutationStream } from "./store-mutations.js";
import { createRelayStoreNormalizers } from "./store-codec-normalizers.js";
import {
  isExpiredStoredAcceptedMessageReceipt,
  isExpiredStoredAccountQuotaRecord,
  normalizeAccountRestriction,
  isExpiredStoredAccountRestriction,
  normalizeAccountQuotaRecord
} from "./store-codec-normalizers.js";

export interface StoredRelayState {
  version: 1;
  savedAt: string;
  teams: TeamRecord[];
  rooms: RoomRecord[];
  invites: InviteRecordType[];
  devices?: DeviceRecord[];
  keyPackages?: KeyPackageRecordType[];
  consumedKeyPackages?: ConsumedKeyPackageRecord[];
  inviteRequests?: InviteJoinRequestRecord[];
  inviteResponses?: InviteResponseRecord[];
  inviteAckReceipts?: InviteAckReceipt[];
  acceptedMessageReceipts?: AcceptedMessageReceipt[];
  teamMembers?: Array<{
    teamId: string;
    members: TeamMemberRecord[];
  }>;
  authSessions?: StoredAuthSession[];
  accountRestrictions?: AccountRestriction[];
  accountQuotaRecords?: AccountQuotaRecord[];
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
  drainStoredRelayMutations(): StoredRelayMutation[];
  discardStoredRelayMutations(): void;
}

export interface RelayStoreCodecOptions {
  store: RelayStore;
  attachmentBlobMaxBytes: number;
  maxAttachmentBlobIdChars: number;
  maxAttachmentBlobNameChars: number;
  maxAttachmentBlobTypeChars: number;
  maxDeviceIdChars: number;
  maxEnvelopeIdChars: number;
  maxHostNameChars: number;
  maxMlsMessageChars: number;
  maxPublicKeyJwkChars: number;
  maxRoomIdChars: number;
  maxRoomNameChars: number;
  maxTeamIdChars: number;
  maxTeamNameChars: number;
  maxUserIdChars: number;
  normalizeStoredAuthSession: (stored: unknown) => NormalizedStoredAuthSession | null;
  pruneMlsBacklog: (messages: MlsRelayMessage[]) => MlsRelayMessage[];
  storedAuthSessions: (authSessions: Map<string, AuthSession>) => StoredAuthSession[];
  now?: () => number;
}

export function createRelayStoreCodec(options: RelayStoreCodecOptions): RelayStoreCodec {
  const { store } = options;
  const now = options.now ?? Date.now;

  const {
    deviceKey,
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
  } = createRelayStoreNormalizers(options);

  const mutationStream = createStoredRelayMutationStream({
    store,
    now,
    isExpiredInvite,
    isExpiredAttachmentBlob,
    pruneMlsBacklog: options.pruneMlsBacklog,
    storedAuthSessions: options.storedAuthSessions
  });

  function applyStoredRows<T>(
    value: unknown,
    normalize: (candidate: unknown) => T | null,
    apply: (normalized: T) => void,
    criticalEntity?: string,
    intentionallyDiscardable?: (candidate: unknown) => boolean
  ): void {
    for (const candidate of storedArray(value)) {
      const normalized = normalize(candidate);
      if (normalized) apply(normalized);
      else if (criticalEntity && !intentionallyDiscardable?.(candidate)) {
        throw new Error(`Stored relay ${criticalEntity} row failed validation.`);
      }
    }
  }

  function applyStoredState(stored: Record<string, unknown>): void {
    if (stored.version !== 1) throw new Error("Stored relay state has an unsupported version.");
    applyStoredRows(stored.teams, normalizeTeam, (team) => store.teams.set(team.id, team), "team");
    applyStoredRows(stored.rooms, normalizeRoom, (room) => store.rooms.set(room.id, room), "room");
    applyStoredRows(stored.invites, normalizeInvite, (invite) => {
      if (!isExpiredInvite(invite)) store.invites.set(invite.id, invite);
    });
    applyStoredRows(
      stored.devices,
      normalizeDevice,
      (device) => {
        store.devices.set(deviceKey(device.userId, device.deviceId), device);
      },
      "device"
    );
    applyStoredRows(stored.keyPackages, normalizeKeyPackage, (keyPackage) => {
      if (!store.keyPackages.has(keyPackage.id)) store.setKeyPackage(keyPackage);
    });
    applyStoredRows(
      stored.consumedKeyPackages,
      (item) =>
        normalizeConsumedKeyPackage(item, options.maxTeamIdChars, options.maxUserIdChars, options.maxDeviceIdChars),
      (item) => store.consumedKeyPackages.set(item.keyPackageHash, item),
      "consumed KeyPackage"
    );
    applyStoredRows(stored.inviteRequests, normalizeRequest, (request) => {
      if (!store.inviteRequests.has(request.requestId)) store.inviteRequests.set(request.requestId, request);
    });
    applyStoredRows(stored.inviteResponses, normalizeWelcome, (response) => {
      if (!store.inviteResponses.has(response.requestId)) store.inviteResponses.set(response.requestId, response);
    });
    const restoredMembershipTeams = new Set<string>();
    for (const item of storedArray(stored.teamMembers)) {
      const teamId = storedTeamMembershipKey(item);
      if (!teamId || restoredMembershipTeams.has(teamId)) {
        throw new Error("Stored relay team-member row failed validation.");
      }
      if (!applyStoredTeamMembers(item)) throw new Error("Stored relay team-member row failed validation.");
      restoredMembershipTeams.add(teamId);
    }
    applyStoredRows(stored.inviteAckReceipts, normalizeInviteAckReceipt, (receipt) => {
      store.inviteAckReceipts.set(receipt.requestId, receipt);
    });
    applyStoredRows(
      stored.acceptedMessageReceipts,
      normalizeAcceptedMessageReceipt,
      (receipt) => {
        store.acceptedMessageReceipts.set(`${receipt.roomKey}\0${receipt.messageId}`, receipt);
      },
      "accepted-message-receipt",
      (candidate) => isExpiredStoredAcceptedMessageReceipt(candidate, now())
    );
    applyStoredRows(stored.attachmentBlobs, normalizeAttachmentBlob, (blob) => {
      if (!isExpiredAttachmentBlob(blob)) store.attachmentBlobs.set(blob.id, blob);
    });
    applyStoredRows(stored.authSessions, options.normalizeStoredAuthSession, (session) => {
      store.authSessions.set(session.sessionIdHash, session.session);
    });
    applyStoredRows(
      stored.accountRestrictions,
      (item) => normalizeAccountRestriction(item, now(), options.maxUserIdChars),
      (restriction) => store.accountRestrictions.set(restriction.userId, restriction),
      "account-restriction",
      (candidate) => isExpiredStoredAccountRestriction(candidate, now())
    );
    applyStoredRows(
      stored.accountQuotaRecords,
      (item) => normalizeAccountQuotaRecord(item, now()),
      (quota) => store.accountQuotaRecords.set(quota.key, quota),
      "account-quota",
      (candidate) => isExpiredStoredAccountQuotaRecord(candidate, now())
    );
    applyStoredRows(
      stored.mlsBacklog,
      normalizeStoredBacklog,
      (backlog) => {
        if (backlog.messages.length > 0) store.mlsBacklog.set(backlog.key, backlog.messages);
      },
      "MLS backlog"
    );
    validateCriticalRelationships(restoredMembershipTeams);
  }

  function validateCriticalRelationships(restoredMembershipTeams: Set<string>): void {
    const liveKeyPackageHashes = new Set<string>();
    for (const keyPackage of store.keyPackages.values()) {
      if (
        liveKeyPackageHashes.has(keyPackage.keyPackageHash) ||
        store.consumedKeyPackages.has(keyPackage.keyPackageHash)
      ) {
        throw new Error("Stored relay KeyPackage one-shot state failed validation.");
      }
      liveKeyPackageHashes.add(keyPackage.keyPackageHash);
    }
    for (const [teamId, team] of store.teams) {
      const members = store.teamMembers.get(teamId);
      if (team.members === 0 && !members?.size) continue;
      if (!restoredMembershipTeams.has(teamId) || !members || members.size !== team.members) {
        throw new Error("Stored relay team membership count failed validation.");
      }
      const owners = Array.from(members.values()).filter((member) => member.role === "owner");
      if (owners.length !== 1) throw new Error("Stored relay team ownership failed validation.");
    }
    for (const room of store.rooms.values()) {
      if (room.hostUserId && !store.teamMembers.get(room.teamId)?.has(room.hostUserId)) {
        throw new Error("Stored relay room host membership failed validation.");
      }
    }
  }

  function pruneMap<T>(records: Map<string, T>, expired: (record: T) => boolean): void {
    for (const [key, record] of records) if (expired(record)) records.delete(key);
  }

  function pruneExpiredInvites(): void {
    for (const [id, invite] of store.invites) {
      if (!isExpiredInvite(invite)) continue;
      store.invites.delete(id);
      pruneMap(store.inviteRequests, (request) => request.inviteId === id);
      pruneMap(store.inviteResponses, (response) => response.inviteId === id);
    }
  }

  function capOldest<T>(records: Map<string, T>, timestamp: (record: T) => number, maximum: number): void {
    const sorted = Array.from(records.entries()).sort((left, right) => timestamp(left[1]) - timestamp(right[1]));
    for (const [id] of sorted.slice(0, Math.max(0, sorted.length - maximum))) records.delete(id);
  }

  function acceptedReceiptPoolKey(receipt: AcceptedMessageReceipt): string {
    return receipt.messageType === "commit"
      ? `${receipt.roomKey}\0commit`
      : `${receipt.roomKey}\0application\0${receipt.senderUserId}`;
  }

  function pruneAcceptedMessageReceipts(): void {
    pruneMap(
      store.acceptedMessageReceipts,
      (receipt) => Date.parse(receipt.acceptedAt) < now() - 180 * 24 * 60 * 60 * 1000
    );
    const pools = new Map<string, Array<[string, AcceptedMessageReceipt]>>();
    for (const entry of store.acceptedMessageReceipts) {
      const [, receipt] = entry;
      const key = acceptedReceiptPoolKey(receipt);
      const pool = pools.get(key) ?? [];
      pool.push(entry);
      pools.set(key, pool);
    }
    for (const pool of pools.values()) {
      pool.sort((left, right) => Date.parse(left[1].acceptedAt) - Date.parse(right[1].acceptedAt));
      for (const [id] of pool.slice(0, Math.max(0, pool.length - 4096))) store.acceptedMessageReceipts.delete(id);
    }
  }

  function pruneMlsBacklogs(): void {
    for (const [key, messages] of store.mlsBacklog) {
      const separator = key.indexOf(":");
      const room = separator >= 0 ? store.getRoom(key.slice(separator + 1)) : undefined;
      if (!room || room.archivedAt || room.deletedAt) {
        store.mlsBacklog.delete(key);
        continue;
      }
      const pruned = options.pruneMlsBacklog(messages);
      if (pruned.length) store.mlsBacklog.set(key, pruned);
      else store.mlsBacklog.delete(key);
    }
  }

  function pruneExpiredState(): void {
    pruneMap(store.authSessions, (session) => session.expiresAt <= now());
    pruneMap(store.accountRestrictions, (restriction) =>
      Boolean(restriction.expiresAt && Date.parse(restriction.expiresAt) <= now())
    );
    pruneMap(store.accountQuotaRecords, (quota) => quota.resetAt <= now());
    pruneExpiredInvites();
    pruneMap(store.inviteAckReceipts, (receipt) => Date.parse(receipt.expiresAt) <= now());
    capOldest(store.inviteAckReceipts, (receipt) => Date.parse(receipt.acknowledgedAt), 4096);
    pruneAcceptedMessageReceipts();
    pruneMap(store.attachmentBlobs, isExpiredAttachmentBlob);
    pruneMlsBacklogs();
  }

  return {
    isExpiredInvite,
    isExpiredAttachmentBlob,
    applyStoredRelayState: applyStoredState,
    pruneExpiredRelayState: pruneExpiredState,
    drainStoredRelayMutations() {
      return mutationStream.drain();
    },
    discardStoredRelayMutations() {
      mutationStream.discard();
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
        consumedKeyPackages: Array.from(store.consumedKeyPackages.values()),
        inviteRequests: Array.from(store.inviteRequests.values()),
        inviteResponses: Array.from(store.inviteResponses.values()),
        inviteAckReceipts: Array.from(store.inviteAckReceipts.values()),
        acceptedMessageReceipts: Array.from(store.acceptedMessageReceipts.values()),
        teamMembers: Array.from(store.teamMembers.entries()).map(([teamId, members]) => ({
          teamId,
          members: Array.from(members.values())
        })),
        authSessions: options.storedAuthSessions(store.authSessions),
        accountRestrictions: Array.from(store.accountRestrictions.values()).filter(
          (restriction) => !restriction.expiresAt || Date.parse(restriction.expiresAt) > now()
        ),
        accountQuotaRecords: Array.from(store.accountQuotaRecords.values()).filter((quota) => quota.resetAt > now()),
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

function isBoundedStoredText(value: unknown, maxChars: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxChars;
}

function isStoredTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeConsumedKeyPackage(
  value: unknown,
  maxTeamIdChars: number,
  maxUserIdChars: number,
  maxDeviceIdChars: number
): ConsumedKeyPackageRecord | null {
  if (!isRecord(value) || Array.isArray(value)) return null;
  const { keyPackageHash, teamId, userId, deviceId, consumedAt } = value;
  if (!isConsumedKeyPackageHash(keyPackageHash)) return null;
  if (!isOptionalBoundedStoredText(teamId, maxTeamIdChars)) return null;
  if (!isValidConsumedKeyPackageOwner(userId, deviceId, maxUserIdChars, maxDeviceIdChars)) return null;
  if (!isStoredTimestamp(consumedAt)) return null;
  return consumedKeyPackageRecord(keyPackageHash, teamId, userId, deviceId, consumedAt);
}

function isConsumedKeyPackageHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function consumedKeyPackageRecord(
  keyPackageHash: string,
  teamId: unknown,
  userId: unknown,
  deviceId: unknown,
  consumedAt: string
): ConsumedKeyPackageRecord {
  const hasOwner = userId !== undefined || deviceId !== undefined;
  return {
    keyPackageHash,
    ...(teamId !== undefined ? { teamId: teamId as string } : {}),
    consumedAt,
    ...(hasOwner ? { userId: userId as string, deviceId: deviceId as string } : {})
  };
}

function isOptionalBoundedStoredText(value: unknown, maxChars: number): boolean {
  return value === undefined || isBoundedStoredText(value, maxChars);
}

function isValidConsumedKeyPackageOwner(
  userId: unknown,
  deviceId: unknown,
  maxUserIdChars: number,
  maxDeviceIdChars: number
): boolean {
  if (userId === undefined && deviceId === undefined) return true;
  return isBoundedStoredText(userId, maxUserIdChars) && isBoundedStoredText(deviceId, maxDeviceIdChars);
}

function storedTeamMembershipKey(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const teamId = Reflect.get(value, "teamId");
  return typeof teamId === "string" ? teamId : null;
}

function storedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
