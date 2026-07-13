import {
  type MlsRelayMessage,
  type AttachmentBlobRecord as AttachmentBlobRecordType,
  type DeviceRecord,
  type InviteRecord as InviteRecordType,
  type KeyPackageRecord as KeyPackageRecordType,
  type RoomRecord,
  type TeamRecord
} from "@multaiplayer/protocol";
import type { NormalizedStoredAuthSession, StoredAuthSession } from "./auth/session.js";
import type { AcceptedMessageReceipt, AuthSession, RelayStore, RoomKey } from "./state.js";
import type { StoredRelayMutation } from "./persistence-types.js";
import { createStoredRelayMutationStream } from "./store-mutations.js";
import { createRelayStoreNormalizers } from "./store-codec-normalizers.js";

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
  drainStoredRelayMutations(): StoredRelayMutation[];
  discardStoredRelayMutations(): void;
}

export interface RelayStoreCodecOptions {
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
