import type { AccountRestriction, RelayStore } from "../state.js";

export interface AccountRestrictionLiveControl {
  revokeUserSessions(userId: string, message: string, closeReason: string): void;
}

export function isAccountRestricted(store: Pick<RelayStore, "accountRestrictions">, userId: string, now = Date.now()) {
  const restriction = store.accountRestrictions.get(userId);
  return Boolean(restriction && (!restriction.expiresAt || Date.parse(restriction.expiresAt) > now));
}

export function createAccountRestrictionManager(options: {
  store: RelayStore;
  liveControl: AccountRestrictionLiveControl;
  persist: () => Promise<void>;
  now?: () => number;
}) {
  async function restrictAccount(restriction: AccountRestriction) {
    validateAccountRestriction(restriction);
    const previous = options.store.accountRestrictions.get(restriction.userId);
    options.store.accountRestrictions.set(restriction.userId, restriction);
    try {
      await options.persist();
    } catch (error) {
      if (previous) options.store.accountRestrictions.set(restriction.userId, previous);
      else options.store.accountRestrictions.delete(restriction.userId);
      throw error;
    }
    evictAccount(restriction.userId);
    await options.persist();
  }

  async function unrestrictAccount(userId: string) {
    const previous = options.store.accountRestrictions.get(userId);
    if (!previous) return false;
    options.store.accountRestrictions.delete(userId);
    try {
      await options.persist();
    } catch (error) {
      options.store.accountRestrictions.set(userId, previous);
      throw error;
    }
    return true;
  }

  function evictRestrictedAccounts() {
    let removedAuthSessions = 0;
    let removedRestrictions = 0;
    const now = options.now?.() ?? Date.now();
    for (const [userId, restriction] of options.store.accountRestrictions) {
      if (restriction.expiresAt && Date.parse(restriction.expiresAt) <= now) {
        options.store.accountRestrictions.delete(userId);
        removedRestrictions += 1;
        continue;
      }
      removedAuthSessions += evictAccount(userId);
    }
    return { removedAuthSessions, removedRestrictions };
  }

  function evictAccount(userId: string) {
    let removedAuthSessions = 0;
    for (const [sessionId, session] of options.store.authSessions) {
      if (session.user.id === userId) {
        options.store.authSessions.delete(sessionId);
        removedAuthSessions += 1;
      }
    }
    for (const [token, session] of options.store.deviceSessions) {
      if (session.userId === userId) options.store.deviceSessions.delete(token);
    }
    for (const [challengeId, challenge] of options.store.deviceChallenges) {
      if (challenge.userId === userId) options.store.deviceChallenges.delete(challengeId);
    }
    options.liveControl.revokeUserSessions(
      userId,
      "This account is restricted by the relay operator.",
      "Account restricted"
    );
    return removedAuthSessions;
  }

  return { restrictAccount, unrestrictAccount, evictRestrictedAccounts };
}

export function validateAccountRestriction(restriction: AccountRestriction) {
  if (
    !restriction.userId ||
    restriction.userId !== restriction.userId.trim() ||
    restriction.userId.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(restriction.userId)
  ) {
    throw new Error("Account restriction user id must be non-empty, bounded, and control-character free.");
  }
  if (!/^[a-z0-9_]{1,64}$/.test(restriction.reasonCode)) {
    throw new Error("Account restriction reason code must use 1-64 lowercase letters, digits, or underscores.");
  }
  if (!Number.isFinite(Date.parse(restriction.createdAt))) throw new Error("Account restriction createdAt is invalid.");
  if (
    restriction.expiresAt &&
    (!Number.isFinite(Date.parse(restriction.expiresAt)) || Date.parse(restriction.expiresAt) <= Date.now())
  ) {
    throw new Error("Account restriction expiry must be a valid future timestamp.");
  }
}
