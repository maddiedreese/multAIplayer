import type { InviteJoinRequestRecord, InviteRecord, KeyPackageRecord } from "@multaiplayer/protocol";
import { isActiveRoom } from "../relay-domain.js";
import type { RelayStore } from "../state.js";
import { persistMutationOrRollback } from "./durable-mutation.js";

export type KeyPackageConsumptionResult =
  | { status: "accepted"; keyPackage: KeyPackageRecord }
  | { status: "already_consumed" }
  | { status: "authorization_changed" }
  | { status: "invite_mismatch" }
  | { status: "request_mismatch" }
  | { status: "key_package_unavailable" }
  | { status: "key_package_mismatch" }
  | { status: "persistence_unavailable" };

const consumptionTurnTails = new WeakMap<object, Map<string, Promise<void>>>();

/**
 * Serialize the check, mutation, durable write, and possible rollback for one
 * KeyPackage. A retry cannot observe the optimistic in-memory mutation until
 * the preceding persistence attempt has either committed or been restored.
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
  persist: () => Promise<void>;
}): Promise<KeyPackageConsumptionResult> {
  const release = await acquireConsumptionTurn(options.store, options.keyPackageId);
  try {
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
    const request = findMatchingInviteRequest(options.store, invite.id, options);
    if (!request) return { status: "request_mismatch" };

    const item = options.store.keyPackages.get(options.keyPackageId);
    if (!item) {
      return inviteAlreadyConsumed(invite, options)
        ? { status: "already_consumed" }
        : { status: "key_package_unavailable" };
    }
    if (!keyPackageMatchesRequest(item, options)) return { status: "key_package_mismatch" };

    options.store.deleteKeyPackage(item.id);
    options.store.setInvite({
      ...invite,
      approvedUserId: item.userId,
      approvedDeviceId: item.deviceId,
      keyPackageHash: item.keyPackageHash
    });
    const persisted = await persistMutationOrRollback({
      persist: options.persist,
      rollback: () => {
        options.store.setKeyPackage(item);
        options.store.setInvite(invite);
      }
    });
    return persisted ? { status: "accepted", keyPackage: item } : { status: "persistence_unavailable" };
  } finally {
    release();
  }
}

async function acquireConsumptionTurn(store: object, keyPackageId: string): Promise<() => void> {
  const tails = consumptionTurnTails.get(store) ?? new Map<string, Promise<void>>();
  consumptionTurnTails.set(store, tails);
  const previous = tails.get(keyPackageId) ?? Promise.resolve();
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const tail = previous.then(() => turn);
  tails.set(keyPackageId, tail);
  await previous;
  return () => {
    releaseTurn();
    if (tails.get(keyPackageId) === tail) tails.delete(keyPackageId);
    if (tails.size === 0 && consumptionTurnTails.get(store) === tails) consumptionTurnTails.delete(store);
  };
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
