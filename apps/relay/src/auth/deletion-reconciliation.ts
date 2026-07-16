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
    super(
      `Deletion reconciliation blocked for subject ${subject}: the restored identity owns active relay resources; keep the relay isolated and resolve the restore manually.`
    );
  }
}

export async function reconcileDeletionLedger(options: {
  ledger: DeletionLedger;
  store: RelayStore;
  persist: () => Promise<void>;
  now?: () => Date;
  deleteOwnedResourcesForSubject?: string;
}): Promise<{
  entries: number;
  pending: number;
  identitiesDeleted: number;
  markersPruned: number;
  conflictsResolved: number;
}> {
  // Authenticate and reconcile the complete ledger before expiry collection.
  // An expired entry can still represent a deletion whose primary commit never
  // succeeded; purging it first would resurrect that identity permanently.
  const entries = await options.ledger.list();
  const pending = entries.filter((entry) => !options.store.appliedDeletionLedgerEntries.has(entry.id));
  const entriesBySubject = groupBySubject(entries);
  const entriesApplied = [...entries];
  let identitiesDeleted = 0;
  let conflictsResolved = 0;
  for (const userId of relayIdentityIds(options.store)) {
    const subject = options.ledger.subjectFor(userId);
    if (!entriesBySubject.has(subject)) continue;
    const blockers = findAccountDeletionBlockers(options.store, userId);
    if (blockers.ownedTeams.length > 0 || blockers.hostedRooms.length > 0) {
      if (options.deleteOwnedResourcesForSubject !== subject) {
        throw new DeletionReconciliationBlockedError(subject, blockers);
      }
      const deletedAt = (options.now ?? (() => new Date()))().toISOString();
      for (const team of blockers.ownedTeams) {
        deleteOwnedTeam(options.store, team.id, deletedAt);
      }
      for (const room of blockers.hostedRooms) {
        const record = options.store.getRoom(room.id);
        if (record) options.store.setRoom({ ...record, deletedAt, hostStatus: "offline" });
      }
      conflictsResolved += 1;
    }
    // Extend protection from the actual cleanup attempt, not merely the
    // original request. A failed/delayed primary commit may have allowed newer
    // backups containing the identity to be created in the meantime.
    entriesApplied.push(await options.ledger.record(userId));
    deleteAccountOwnedRelayData(options.store, userId);
    identitiesDeleted += 1;
  }

  if (pending.length > 0 || identitiesDeleted > 0) {
    const appliedAt = (options.now ?? (() => new Date()))().toISOString();
    for (const entry of entriesApplied) {
      options.store.appliedDeletionLedgerEntries.set(entry.id, { entryId: entry.id, appliedAt });
    }
    // Persist primary deletion before an expired external entry can be removed.
    await options.persist();
  }

  await options.ledger.purgeExpired(entriesApplied);
  const now = (options.now ?? (() => new Date()))().getTime();
  const activeEntryIds = new Set(
    entriesApplied.filter((entry) => Date.parse(entry.protectUntil) > now).map((entry) => entry.id)
  );
  let markersPruned = 0;
  for (const entryId of options.store.appliedDeletionLedgerEntries.keys()) {
    if (activeEntryIds.has(entryId)) continue;
    if (options.store.appliedDeletionLedgerEntries.delete(entryId)) markersPruned += 1;
  }
  if (markersPruned > 0) await options.persist();

  return {
    entries: entriesApplied.length,
    pending: pending.length,
    identitiesDeleted,
    markersPruned,
    conflictsResolved
  };
}

function deleteOwnedTeam(store: RelayStore, teamId: string, deletedAt: string): void {
  const team = store.getTeam(teamId);
  if (team) store.setTeam({ ...team, archivedAt: undefined, deletedAt });
  for (const room of store.allRooms()) {
    if (room.teamId === teamId && !room.deletedAt) {
      store.setRoom({ ...room, archivedAt: undefined, deletedAt });
    }
  }
  const revokedInviteIds = new Set<string>();
  for (const [inviteId, invite] of store.invites) {
    if (invite.teamId !== teamId) continue;
    store.invites.delete(inviteId);
    revokedInviteIds.add(inviteId);
  }
  for (const [requestId, request] of store.inviteRequests) {
    if (revokedInviteIds.has(request.inviteId)) store.inviteRequests.delete(requestId);
  }
  for (const [requestId, response] of store.inviteResponses) {
    if (revokedInviteIds.has(response.inviteId)) store.inviteResponses.delete(requestId);
  }
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
  for (const quota of store.accountQuotaRecords.values()) ids.add(quota.userId);
  for (const members of store.teamMembers.values()) for (const userId of members.keys()) ids.add(userId);
  for (const room of store.rooms.values()) {
    if (room.hostUserId) ids.add(room.hostUserId);
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
