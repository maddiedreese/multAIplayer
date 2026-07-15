import {
  deleteAccountOwnedRelayData,
  findAccountDeletionBlockers,
  type AccountDeletionBlockers
} from "./account-deletion.js";
import type { DeletionLedger, DeletionLedgerEntry } from "./deletion-ledger.js";
import type { RelayStore } from "../state.js";

export class DeletionReconciliationBlockedError extends Error {
  override readonly name = "DeletionReconciliationBlockedError";
  constructor(
    readonly subject: string,
    readonly blockers: AccountDeletionBlockers
  ) {
    super("A restored identity owns active relay resources; keep the relay isolated and resolve the restore manually.");
  }
}

export async function reconcileDeletionLedger(options: {
  ledger: DeletionLedger;
  store: RelayStore;
  persist: () => Promise<void>;
  now?: () => Date;
}): Promise<{ entries: number; pending: number; identitiesDeleted: number; markersPruned: number }> {
  await options.ledger.purgeExpired();
  const entries = await options.ledger.list();
  const activeEntryIds = new Set(entries.map((entry) => entry.id));
  let markersPruned = 0;
  for (const entryId of options.store.appliedDeletionLedgerEntries.keys()) {
    if (activeEntryIds.has(entryId)) continue;
    if (options.store.appliedDeletionLedgerEntries.delete(entryId)) markersPruned += 1;
  }
  const pending = entries.filter((entry) => !options.store.appliedDeletionLedgerEntries.has(entry.id));
  const entriesBySubject = groupBySubject(entries);
  const entriesApplied = [...entries];
  let identitiesDeleted = 0;
  for (const userId of relayIdentityIds(options.store)) {
    const subject = options.ledger.subjectFor(userId);
    if (!entriesBySubject.has(subject)) continue;
    const blockers = findAccountDeletionBlockers(options.store, userId);
    if (blockers.ownedTeams.length > 0 || blockers.hostedRooms.length > 0) {
      throw new DeletionReconciliationBlockedError(subject, blockers);
    }
    // Extend protection from the actual cleanup attempt, not merely the
    // original request. A failed/delayed primary commit may have allowed newer
    // backups containing the identity to be created in the meantime.
    entriesApplied.push(await options.ledger.record(userId));
    deleteAccountOwnedRelayData(options.store, userId);
    identitiesDeleted += 1;
  }

  if (pending.length === 0 && identitiesDeleted === 0 && markersPruned === 0) {
    return { entries: entries.length, pending: 0, identitiesDeleted: 0, markersPruned: 0 };
  }
  const appliedAt = (options.now ?? (() => new Date()))().toISOString();
  for (const entry of entriesApplied) {
    options.store.appliedDeletionLedgerEntries.set(entry.id, { entryId: entry.id, appliedAt });
  }
  await options.persist();
  return { entries: entriesApplied.length, pending: pending.length, identitiesDeleted, markersPruned };
}

function groupBySubject(entries: DeletionLedgerEntry[]): Map<string, DeletionLedgerEntry[]> {
  const grouped = new Map<string, DeletionLedgerEntry[]>();
  for (const entry of entries) grouped.set(entry.subject, [...(grouped.get(entry.subject) ?? []), entry]);
  return grouped;
}

/** Enumerate only identifiers already present in primary relay state. */
export function relayIdentityIds(store: RelayStore): Set<string> {
  const ids = new Set<string>();
  for (const session of store.authSessions.values()) ids.add(session.user.id);
  for (const session of store.deviceSessions.values()) ids.add(session.userId);
  for (const device of store.devices.values()) ids.add(device.userId);
  for (const keyPackage of store.keyPackages.values()) ids.add(keyPackage.userId);
  for (const members of store.teamMembers.values()) for (const userId of members.keys()) ids.add(userId);
  for (const room of store.rooms.values()) {
    if (room.hostUserId) ids.add(room.hostUserId);
    for (const userId of room.trustedApproverUserIds) ids.add(userId);
  }
  for (const invite of store.invites.values()) {
    if (invite.creatorUserId) ids.add(invite.creatorUserId);
    if (invite.approvedUserId) ids.add(invite.approvedUserId);
  }
  for (const request of store.inviteRequests.values()) ids.add(request.requesterUserId);
  for (const response of store.inviteResponses.values()) {
    ids.add(response.requesterUserId);
    ids.add(response.responseBinding.hostUserId);
  }
  for (const receipt of store.inviteAckReceipts.values()) ids.add(receipt.requesterUserId);
  return ids;
}
