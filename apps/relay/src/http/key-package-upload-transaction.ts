import type { KeyPackageRecord } from "@multaiplayer/protocol";
import type { RelayStore } from "../state.js";
import { acquireAccountMutationTurn } from "../auth/account-mutation-transaction.js";

export type KeyPackageUploadCommitResult =
  | { status: "accepted"; count: number }
  | { status: "account_quota"; used: number }
  | { status: "device_quota" }
  | { status: "conflict" }
  | { status: "already_consumed" }
  | { status: "authorization_changed" }
  | { status: "persistence_unavailable" };

export async function commitValidatedKeyPackages(options: {
  store: RelayStore;
  userId: string;
  deviceId: string;
  accepted: KeyPackageRecord[];
  accountLimit: number;
  deviceLimit: number;
  authorizationRemainsValid: () => boolean;
  persist: () => Promise<void>;
}): Promise<KeyPackageUploadCommitResult> {
  const release = await acquireAccountMutationTurn(options.store, options.userId);
  try {
    if (!options.authorizationRemainsValid()) return { status: "authorization_changed" };
    const deviceUsed = options.store.keyPackagesForDevice(options.userId, options.deviceId).length;
    if (deviceUsed + options.accepted.length > options.deviceLimit) return { status: "device_quota" };
    const accountUsed = accountPackageCount(options.store, options.userId);
    if (accountUsed + options.accepted.length > options.accountLimit) {
      return { status: "account_quota", used: accountUsed };
    }
    if (options.accepted.some((item) => options.store.consumedKeyPackages.has(item.keyPackageHash))) {
      return { status: "already_consumed" };
    }
    const liveHashes = new Set(Array.from(options.store.keyPackages.values(), (item) => item.keyPackageHash));
    if (
      options.accepted.some((item) => options.store.keyPackages.has(item.id) || liveHashes.has(item.keyPackageHash))
    ) {
      return { status: "conflict" };
    }
    if (!options.store.getDevice(options.userId, options.deviceId)) return { status: "authorization_changed" };
    try {
      for (const item of options.accepted) options.store.setKeyPackage(item);
    } catch (error) {
      rollbackContribution(options.store, options.accepted);
      throw error;
    }
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
