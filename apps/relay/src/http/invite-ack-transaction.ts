import type { InviteRecord, InviteResponseRecord as InviteResponseRecordType } from "@multaiplayer/protocol";
import { isActiveRoom } from "../relay-domain.js";
import type { RelayStore } from "../state.js";
import { persistMutationOrRollback } from "./durable-mutation.js";

export function inviteIsExpired(invite: InviteRecord | undefined, now = Date.now()): boolean {
  return Boolean(invite?.expiresAt && Date.parse(invite.expiresAt) <= now);
}

export async function ackInviteResponseAtomically(
  store: RelayStore,
  record: InviteResponseRecordType,
  saveRelayStore: () => Promise<void>
): Promise<"ok" | "missing_team" | "inactive_target" | "expired" | "revoked" | "persistence_failed"> {
  const team = store.getTeam(record.responseBinding.teamId);
  if (!team) return "missing_team";
  if (!isActiveRoom(store, record.responseBinding.teamId, record.responseBinding.roomId)) return "inactive_target";
  const previousMembers = new Map(store.getTeamMembers(team.id) ?? []);
  const invite = store.getInvite(record.inviteId);
  if (inviteIsExpired(invite)) return "expired";
  if (!inviteResponseRemainsAuthorized(invite, record)) return "revoked";
  const previousReceipts = new Map(store.inviteAckReceipts);
  if (record.status === "approved") {
    const members = new Map(previousMembers);
    if (!members.has(record.requesterUserId)) {
      members.set(record.requesterUserId, {
        teamId: team.id,
        userId: record.requesterUserId,
        role: "member",
        joinedAt: new Date().toISOString()
      });
    }
    store.setTeamMembers(team.id, members);
    store.setTeam({ ...team, members: members.size });
  }
  store.deleteInvite(record.inviteId);
  store.inviteResponses.delete(record.requestId);
  store.inviteAckReceipts.set(record.requestId, {
    inviteId: record.inviteId,
    requestId: record.requestId,
    teamId: team.id,
    requesterUserId: record.requesterUserId,
    requesterDeviceId: record.requesterDeviceId,
    keyPackageHash: record.keyPackageHash,
    status: record.status,
    acknowledgedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });
  pruneInviteAckReceipts(store);
  const persisted = await persistMutationOrRollback({
    persist: saveRelayStore,
    rollback: () => {
      store.inviteResponses.set(record.requestId, record);
      store.setTeamMembers(team.id, previousMembers);
      store.setTeam(team);
      if (invite) store.setInvite(invite);
      store.inviteAckReceipts.clear();
      for (const [id, receipt] of previousReceipts) store.inviteAckReceipts.set(id, receipt);
    }
  });
  return persisted ? "ok" : "persistence_failed";
}

function inviteResponseRemainsAuthorized(
  invite: InviteRecord | undefined,
  record: InviteResponseRecordType
): invite is InviteRecord {
  if (!invite) return false;
  const binding = record.responseBinding;
  if (invite.teamId !== binding.teamId || invite.roomId !== binding.roomId) return false;
  if (binding.inviteId !== record.inviteId || binding.requestId !== record.requestId) return false;
  if (binding.requesterUserId !== record.requesterUserId || binding.requesterDeviceId !== record.requesterDeviceId) {
    return false;
  }
  if (binding.keyPackageHash !== record.keyPackageHash || binding.status !== record.status) return false;
  if (record.status !== "approved") return true;
  return (
    invite.approvedUserId === record.requesterUserId &&
    invite.approvedDeviceId === record.requesterDeviceId &&
    invite.keyPackageHash === record.keyPackageHash
  );
}

function pruneInviteAckReceipts(store: RelayStore) {
  const now = Date.now();
  const ordered = Array.from(store.inviteAckReceipts.entries()).sort(
    (left, right) => Date.parse(left[1].acknowledgedAt) - Date.parse(right[1].acknowledgedAt)
  );
  for (const [id, receipt] of ordered) if (Date.parse(receipt.expiresAt) <= now) store.inviteAckReceipts.delete(id);
  const retained = ordered.filter(([id]) => store.inviteAckReceipts.has(id));
  for (const [id] of retained.slice(0, Math.max(0, retained.length - 4096))) store.inviteAckReceipts.delete(id);
}
