import type { AuthSession, RelayStore } from "../state.js";

const accountTurnTails = new WeakMap<object, Map<string, Promise<void>>>();

/** Serialize identity-owned durable mutations for one hosted account. */
export async function acquireAccountMutationTurn(store: object, userId: string): Promise<() => void> {
  const tails = accountTurnTails.get(store) ?? new Map<string, Promise<void>>();
  accountTurnTails.set(store, tails);
  const previous = tails.get(userId) ?? Promise.resolve();
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const tail = previous.then(() => turn);
  tails.set(userId, tail);
  await previous;
  return () => {
    releaseTurn();
    if (tails.get(userId) === tail) tails.delete(userId);
    if (tails.size === 0 && accountTurnTails.get(store) === tails) accountTurnTails.delete(store);
  };
}

/**
 * Acquire several account turns without lock-order inversions. Cross-account
 * authority changes must protect both the current and proposed authority.
 */
export async function acquireAccountMutationTurns(store: object, userIds: Iterable<string>): Promise<() => void> {
  const orderedUserIds = Array.from(new Set(userIds)).sort((left, right) => left.localeCompare(right));
  const releases: Array<() => void> = [];
  try {
    for (const userId of orderedUserIds) releases.push(await acquireAccountMutationTurn(store, userId));
  } catch (error) {
    for (const release of releases.reverse()) release();
    throw error;
  }
  return () => {
    for (const release of releases.reverse()) release();
  };
}

/** Confirm that the session authorizing a queued mutation still exists. */
export function isLiveAccountSession(store: RelayStore, session: AuthSession): boolean {
  return store.authSessions.get(session.sessionIdHash) === session && session.expiresAt > Date.now();
}
