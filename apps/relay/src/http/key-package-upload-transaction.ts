import type { KeyPackageRecord } from "@multaiplayer/protocol";
import type { RelayStore } from "../state.js";

export type KeyPackageUploadCommitResult =
  | { status: "accepted"; count: number }
  | { status: "account_quota"; used: number }
  | { status: "device_quota" }
  | { status: "conflict" }
  | { status: "persistence_unavailable" };

const uploadTurnTails = new WeakMap<object, Map<string, Promise<void>>>();

export async function commitValidatedKeyPackages(options: {
  store: RelayStore;
  userId: string;
  deviceId: string;
  accepted: KeyPackageRecord[];
  accountLimit: number;
  deviceLimit: number;
  persist: () => Promise<void>;
}): Promise<KeyPackageUploadCommitResult> {
  const release = await acquireUploadTurn(options.store, options.userId, options.deviceId);
  try {
    const deviceUsed = options.store.keyPackagesForDevice(options.userId, options.deviceId).length;
    if (deviceUsed + options.accepted.length > options.deviceLimit) return { status: "device_quota" };
    const accountUsed = accountPackageCount(options.store, options.userId);
    if (accountUsed + options.accepted.length > options.accountLimit) {
      return { status: "account_quota", used: accountUsed };
    }
    if (options.accepted.some((item) => options.store.keyPackages.has(item.id))) return { status: "conflict" };
    for (const item of options.accepted) options.store.setKeyPackage(item);
    try {
      await options.persist();
    } catch {
      rollbackContribution(options.store, options.accepted);
      return { status: "persistence_unavailable" };
    }
    return {
      status: "accepted",
      count: options.store.keyPackagesForDevice(options.userId, options.deviceId).length
    };
  } finally {
    release();
  }
}

async function acquireUploadTurn(store: object, userId: string, deviceId: string) {
  const tails = uploadTurnTails.get(store) ?? new Map<string, Promise<void>>();
  uploadTurnTails.set(store, tails);
  const key = `${userId}\0${deviceId}`;
  const previous = tails.get(key) ?? Promise.resolve();
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const tail = previous.then(() => turn);
  tails.set(key, tail);
  await previous;
  return () => {
    releaseTurn();
    if (tails.get(key) === tail) tails.delete(key);
    if (tails.size === 0 && uploadTurnTails.get(store) === tails) uploadTurnTails.delete(store);
  };
}

function accountPackageCount(store: RelayStore, userId: string): number {
  let count = 0;
  for (const item of store.keyPackages.values()) if (item.userId === userId) count += 1;
  return count;
}

function rollbackContribution(store: RelayStore, accepted: KeyPackageRecord[]): void {
  for (const item of accepted) {
    if (store.keyPackages.get(item.id) === item) store.deleteKeyPackage(item.id);
  }
}
