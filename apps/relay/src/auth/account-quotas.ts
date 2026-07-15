import type { AccountQuotaRecord, RelayStore } from "../state.js";

export type DurableQuota = AccountQuotaRecord["quota"];

const durableQuotaTransactionTails = new WeakMap<object, Promise<void>>();

/**
 * Serializes reserve -> domain mutation -> persistence -> rollback as one
 * in-memory transaction. Persistence may serialize state asynchronously, so
 * letting the next reservation begin after only the save promise settles can
 * capture state before the failed request has rolled back.
 */
export async function acquireDurableQuotaTransaction(store: Pick<RelayStore, "accountQuotaRecords">) {
  const key = store as object;
  const previous = durableQuotaTransactionTails.get(key) ?? Promise.resolve();
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const tail = previous.then(() => turn);
  durableQuotaTransactionTails.set(key, tail);
  await previous;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseTurn();
    if (durableQuotaTransactionTails.get(key) === tail) durableQuotaTransactionTails.delete(key);
  };
}

export function reserveDurableQuota(options: {
  store: Pick<RelayStore, "accountQuotaRecords">;
  quota: DurableQuota;
  userId: string;
  amount?: number;
  limit: number;
  resetAt: number;
  now?: number;
}): { allowed: false; used: number; resetAt: number } | { allowed: true; amount: number; record: AccountQuotaRecord } {
  const amount = options.amount ?? 1;
  const now = options.now ?? Date.now();
  const key = `${options.quota}:${options.userId}`;
  const stored = options.store.accountQuotaRecords.get(key);
  const current = stored && stored.resetAt > now ? stored : undefined;
  const used = current?.used ?? 0;
  const resetAt = current?.resetAt ?? options.resetAt;
  if (used + amount > options.limit) return { allowed: false, used, resetAt };
  const record: AccountQuotaRecord = {
    key,
    userId: options.userId,
    quota: options.quota,
    used: used + amount,
    resetAt
  };
  options.store.accountQuotaRecords.set(key, record);
  return { allowed: true, amount, record };
}

export function rollbackDurableQuota(
  store: Pick<RelayStore, "accountQuotaRecords">,
  reservation: { amount: number; record: AccountQuotaRecord }
) {
  const current = store.accountQuotaRecords.get(reservation.record.key);
  if (!current || current.resetAt !== reservation.record.resetAt) return;
  const used = current.used - reservation.amount;
  if (used <= 0) store.accountQuotaRecords.delete(current.key);
  else store.accountQuotaRecords.set(current.key, { ...current, used });
}

export function nextUtcMidnight(now = Date.now()) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}
