import type { InviteJoinRequestRecord, InviteRecord, KeyPackageRecord } from "@multaiplayer/protocol";
import { isActiveRoom } from "../relay-domain.js";
import type { ConsumedKeyPackageRecord, RelayStore } from "../state.js";
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

interface KeyPackageConsumptionOptions {
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
}

type ConsumptionFailure = Exclude<KeyPackageConsumptionResult, { status: "accepted" }>;

/**
 * Serialize the check, mutation, durable write, and possible rollback across
 * both affected accounts. Upload, deletion, and consumption therefore cannot
 * invalidate either participant while a consumption commits.
 */
export async function consumeKeyPackageForInvite(
  options: KeyPackageConsumptionOptions
): Promise<KeyPackageConsumptionResult> {
  const release = await acquireAccountMutationTurns(options.store, [options.expectedHostUserId, options.userId]);
  try {
    const authorizationFailure = validateConsumptionAuthorization(options);
    if (authorizationFailure) return authorizationFailure;
    const inviteResult = validateConsumptionInvite(options);
    if ("status" in inviteResult) return inviteResult;
    const { invite } = inviteResult;
    const keyPackageResult = validateAvailableKeyPackage(options, invite);
    if ("status" in keyPackageResult) return keyPackageResult;
    const { item } = keyPackageResult;

    const consumed: ConsumedKeyPackageRecord = {
      keyPackageHash: item.keyPackageHash,
      teamId: options.teamId,
      userId: item.userId,
      deviceId: item.deviceId,
      consumedAt: new Date().toISOString()
    };
    const rollback = () => rollbackKeyPackageConsumption(options.store, invite, item, consumed);
    stageKeyPackageConsumption(options.store, invite, item, consumed);
    const persisted = await persistMutationOrRollback({
      persist: options.persist,
      rollback
    });
    return persisted ? { status: "accepted", keyPackage: item } : { status: "persistence_unavailable" };
  } finally {
    release();
  }
}

function validateConsumptionAuthorization(options: KeyPackageConsumptionOptions): ConsumptionFailure | null {
  if (!options.authorizationRemainsValid()) return { status: "authorization_changed" };
  if (!options.store.getDevice(options.userId, options.deviceId)) {
    return { status: "requester_authorization_changed" };
  }
  return hostAuthorizationFailure(options);
}

function hostAuthorizationFailure(options: KeyPackageConsumptionOptions): ConsumptionFailure | null {
  const room = options.store.getRoom(options.roomId);
  const hostRemainsAuthorized =
    room?.teamId === options.teamId &&
    isActiveRoom(options.store, options.teamId, options.roomId) &&
    room.hostStatus === "active" &&
    room.hostUserId === options.expectedHostUserId &&
    room.activeHostDeviceId === options.expectedHostDeviceId;
  return hostRemainsAuthorized ? null : { status: "authorization_changed" };
}

function validateConsumptionInvite(
  options: KeyPackageConsumptionOptions
): { invite: InviteRecord } | ConsumptionFailure {
  const invite = options.store.getInvite(options.inviteId);
  if (!inviteMatchesRoom(invite, options.teamId, options.roomId)) return { status: "invite_mismatch" };
  if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) return { status: "invite_expired" };
  return findMatchingInviteRequest(options.store, invite.id, options) ? { invite } : { status: "request_mismatch" };
}

function validateAvailableKeyPackage(
  options: KeyPackageConsumptionOptions,
  invite: InviteRecord
): { item: KeyPackageRecord } | ConsumptionFailure {
  const item = options.store.keyPackages.get(options.keyPackageId);
  if (!item) return missingKeyPackageFailure(invite, options);
  if (!keyPackageMatchesRequest(item, options)) return { status: "key_package_mismatch" };
  return options.store.consumedKeyPackages.has(item.keyPackageHash) ? { status: "key_package_unavailable" } : { item };
}

function missingKeyPackageFailure(invite: InviteRecord, options: KeyPackageConsumptionOptions): ConsumptionFailure {
  return inviteAlreadyConsumed(invite, options)
    ? { status: "already_consumed" }
    : { status: "key_package_unavailable" };
}

function stageKeyPackageConsumption(
  store: RelayStore,
  invite: InviteRecord,
  item: KeyPackageRecord,
  consumed: ConsumedKeyPackageRecord
): void {
  store.deleteKeyPackage(item.id);
  try {
    store.consumedKeyPackages.set(consumed.keyPackageHash, consumed);
    store.setInvite({
      ...invite,
      approvedUserId: item.userId,
      approvedDeviceId: item.deviceId,
      keyPackageHash: item.keyPackageHash
    });
  } catch (error) {
    rollbackKeyPackageConsumption(store, invite, item, consumed);
    throw error;
  }
}

function rollbackKeyPackageConsumption(
  store: RelayStore,
  invite: InviteRecord,
  item: KeyPackageRecord,
  consumed: ConsumedKeyPackageRecord
): void {
  if (store.consumedKeyPackages.get(consumed.keyPackageHash) === consumed) {
    store.consumedKeyPackages.delete(consumed.keyPackageHash);
  }
  if (!store.keyPackages.has(item.id)) store.setKeyPackage(item);
  if (store.getInvite(invite.id)?.keyPackageHash === item.keyPackageHash) store.setInvite(invite);
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
