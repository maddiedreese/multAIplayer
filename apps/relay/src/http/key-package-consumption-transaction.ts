import type { InviteJoinRequestRecord, InviteRecord, KeyPackageRecord } from "@multaiplayer/protocol";
import { isActiveRoom } from "../relay-domain.js";
import type { RelayStore } from "../state.js";
import { acquireAccountMutationTurns } from "../auth/account-mutation-transaction.js";
import { persistMutationOrRollback } from "./durable-mutation.js";

type KeyPackageConsumptionResult =
  | { status: "accepted"; keyPackage: KeyPackageRecord }
  | { status: "already_consumed" }
  | { status: "authorization_changed" }
  | { status: "requester_authorization_changed" }
  | { status: "invite_mismatch" }
  | { status: "invite_expired" }
  | { status: "request_mismatch" }
  | { status: "key_package_unavailable" }
  | { status: "key_package_mismatch" }
  | { status: "persistence_unavailable" };

/**
 * Serialize the check, mutation, durable write, and possible rollback across
 * both affected accounts. Upload, deletion, and consumption therefore cannot
 * invalidate either participant while a consumption commits.
 */
export async function consumeKeyPackageForInvite(options: {
  store: RelayStore;
  teamId: string;
  roomId: string;
  expectedHostUserId: string;
  expectedHostDeviceId: string;
  inviteId: string;
  userId: string;
  deviceId: string;
  keyPackageId: string;
  keyPackageHash: string;
  authorizationRemainsValid: () => boolean;
  persist: () => Promise<void>;
}): Promise<KeyPackageConsumptionResult> {
  const release = await acquireAccountMutationTurns(options.store, [options.expectedHostUserId, options.userId]);
  try {
    if (!options.authorizationRemainsValid()) return { status: "authorization_changed" };
    if (!options.store.getDevice(options.userId, options.deviceId)) {
      return { status: "requester_authorization_changed" };
    }
    const room = options.store.getRoom(options.roomId);
    if (
      !room ||
      room.teamId !== options.teamId ||
      !isActiveRoom(options.store, options.teamId, options.roomId) ||
      room.hostStatus !== "active" ||
      room.hostUserId !== options.expectedHostUserId ||
      room.activeHostDeviceId !== options.expectedHostDeviceId
    ) {
      return { status: "authorization_changed" };
    }
    const invite = options.store.getInvite(options.inviteId);
    if (!inviteMatchesRoom(invite, options.teamId, options.roomId)) return { status: "invite_mismatch" };
    if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) return { status: "invite_expired" };
    const request = findMatchingInviteRequest(options.store, invite.id, options);
    if (!request) return { status: "request_mismatch" };

    const item = options.store.keyPackages.get(options.keyPackageId);
    if (!item) {
      return inviteAlreadyConsumed(invite, options)
        ? { status: "already_consumed" }
        : { status: "key_package_unavailable" };
    }
    if (!keyPackageMatchesRequest(item, options)) return { status: "key_package_mismatch" };
    if (options.store.consumedKeyPackages.has(item.keyPackageHash)) return { status: "key_package_unavailable" };

    options.store.deleteKeyPackage(item.id);
    const consumed = {
      keyPackageHash: item.keyPackageHash,
      userId: item.userId,
      deviceId: item.deviceId,
      consumedAt: new Date().toISOString()
    };
    options.store.consumedKeyPackages.set(consumed.keyPackageHash, consumed);
    options.store.setInvite({
      ...invite,
      approvedUserId: item.userId,
      approvedDeviceId: item.deviceId,
      keyPackageHash: item.keyPackageHash
    });
    const persisted = await persistMutationOrRollback({
      persist: options.persist,
      rollback: () => {
        if (options.store.consumedKeyPackages.get(consumed.keyPackageHash) === consumed) {
          options.store.consumedKeyPackages.delete(consumed.keyPackageHash);
        }
        if (!options.store.keyPackages.has(item.id)) options.store.setKeyPackage(item);
        if (options.store.getInvite(invite.id)?.keyPackageHash === item.keyPackageHash) options.store.setInvite(invite);
      }
    });
    return persisted ? { status: "accepted", keyPackage: item } : { status: "persistence_unavailable" };
  } finally {
    release();
  }
}

function inviteMatchesRoom(
  invite: InviteRecord | undefined,
  expectedTeamId: string,
  expectedRoomId: string
): invite is InviteRecord {
  return Boolean(invite && invite.roomId === expectedRoomId && invite.teamId === expectedTeamId);
}

function findMatchingInviteRequest(
  store: RelayStore,
  inviteId: string,
  expected: { userId: string; deviceId: string; keyPackageId: string; keyPackageHash: string }
): InviteJoinRequestRecord | undefined {
  return Array.from(store.inviteRequests.values()).find(
    (candidate) =>
      candidate.inviteId === inviteId &&
      candidate.requesterUserId === expected.userId &&
      candidate.requesterDeviceId === expected.deviceId &&
      candidate.keyPackageId === expected.keyPackageId &&
      candidate.keyPackageHash === expected.keyPackageHash
  );
}

function inviteAlreadyConsumed(
  invite: InviteRecord,
  expected: { userId: string; deviceId: string; keyPackageHash: string }
): boolean {
  return (
    invite.approvedUserId === expected.userId &&
    invite.approvedDeviceId === expected.deviceId &&
    invite.keyPackageHash === expected.keyPackageHash
  );
}

function keyPackageMatchesRequest(
  item: KeyPackageRecord,
  expected: { userId: string; deviceId: string; keyPackageHash: string }
): boolean {
  return (
    item.userId === expected.userId &&
    item.deviceId === expected.deviceId &&
    item.keyPackageHash === expected.keyPackageHash
  );
}
