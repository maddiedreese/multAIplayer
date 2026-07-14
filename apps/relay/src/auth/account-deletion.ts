import type {
  DeviceRecord,
  InviteJoinRequestRecord,
  InviteRecord,
  InviteResponseRecord,
  KeyPackageRecord,
  RoomRecord,
  TeamMemberRecord,
  TeamRecord
} from "@multaiplayer/protocol";
import type {
  AuthSession,
  ByteQuotaRecord,
  DeviceChallengeRecord,
  DeviceSessionRecord,
  InviteAckReceipt,
  RateLimitRecord,
  RelayStore
} from "../state.js";

export const accountDeletionConfirmation = "delete my account" as const;

export interface AccountDeletionBlockers {
  ownedTeams: Array<Pick<TeamRecord, "id" | "name">>;
  hostedRooms: Array<Pick<RoomRecord, "id" | "name" | "teamId">>;
}

export interface AccountDeletionSummary {
  authSessions: number;
  deviceSessions: number;
  devices: number;
  keyPackages: number;
  teamMemberships: number;
  inviteArtifacts: number;
  dailyTeamCreationQuotaRecords: number;
  dailyRoomCreationQuotaRecords: number;
  attachmentUploadQuotaRecords: number;
  rateLimitRecords: number;
  deviceChallenges: number;
}

interface AccountDeletionStateSnapshot {
  authSessions: Map<string, AuthSession>;
  deviceSessions: Map<string, DeviceSessionRecord>;
  devices: Map<string, DeviceRecord>;
  keyPackages: Map<string, KeyPackageRecord>;
  rooms: Map<string, RoomRecord>;
  invites: Map<string, InviteRecord>;
  inviteRequests: Map<string, InviteJoinRequestRecord>;
  inviteResponses: Map<string, InviteResponseRecord>;
  inviteAckReceipts: Map<string, InviteAckReceipt>;
  teamMembers: Map<string, Map<string, TeamMemberRecord>>;
  dailyTeamCreationCounts: Map<string, RateLimitRecord>;
  dailyRoomCreationCounts: Map<string, RateLimitRecord>;
  attachmentBlobUploadByteCounts: Map<string, ByteQuotaRecord>;
  rateLimitStore: Map<string, RateLimitRecord>;
  deviceChallenges: Map<string, DeviceChallengeRecord>;
}

export async function deleteAccountOwnedRelayDataAtomically(
  store: RelayStore,
  userId: string,
  persist: () => Promise<void>
): Promise<AccountDeletionSummary> {
  const snapshot = snapshotAccountDeletionState(store, userId);
  let deletedState: AccountDeletionStateSnapshot | null = null;
  try {
    const summary = deleteAccountOwnedRelayData(store, userId);
    deletedState = snapshotAccountDeletionState(store, userId, snapshot);
    await persist();
    return summary;
  } catch (error) {
    if (deletedState) restoreAccountDeletionState(store, snapshot, deletedState);
    throw error;
  }
}

export function findAccountDeletionBlockers(store: RelayStore, userId: string): AccountDeletionBlockers {
  const ownedTeams = Array.from(store.teamMembers.entries())
    .filter(([teamId, members]) => !store.getTeam(teamId)?.deletedAt && members.get(userId)?.role === "owner")
    .map(([teamId]) => store.getTeam(teamId))
    .filter((team): team is TeamRecord => Boolean(team))
    .map(({ id, name }) => ({ id, name }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const hostedRooms = store
    .allRooms()
    .filter((room) => !room.deletedAt && room.hostUserId === userId)
    .map(({ id, name, teamId }) => ({ id, name, teamId }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { ownedTeams, hostedRooms };
}

export function deleteAccountOwnedRelayData(store: RelayStore, userId: string): AccountDeletionSummary {
  const sessionIds = new Set(
    Array.from(store.authSessions, ([sessionId, session]) => (session.user.id === userId ? sessionId : null)).filter(
      (sessionId): sessionId is string => sessionId !== null
    )
  );
  const summary: AccountDeletionSummary = {
    authSessions: deleteMatching(store.authSessions, (_id, session) => session.user.id === userId),
    deviceSessions: deleteMatching(store.deviceSessions, (_token, session) => session.userId === userId),
    devices: deleteMatching(store.devices, (_key, device) => device.userId === userId),
    keyPackages: deleteMatching(store.keyPackages, (_id, keyPackage) => keyPackage.userId === userId),
    teamMemberships: 0,
    inviteArtifacts: 0,
    dailyTeamCreationQuotaRecords: deleteMatching(
      store.dailyTeamCreationCounts,
      (key) => key === `daily_user_team_creations:${userId}`
    ),
    dailyRoomCreationQuotaRecords: deleteMatching(
      store.dailyRoomCreationCounts,
      (key) => key === `daily_user_room_creations:${userId}`
    ),
    attachmentUploadQuotaRecords: deleteMatching(store.attachmentBlobUploadByteCounts, (key) => key === userId),
    rateLimitRecords: deleteMatching(store.rateLimitStore, (key) =>
      Array.from(sessionIds).some((sessionId) => key.endsWith(`:session:${sessionId}`))
    ),
    deviceChallenges: deleteMatching(store.deviceChallenges, (_challenge, record) => record.userId === userId)
  };

  for (const [teamId, members] of store.teamMembers) {
    if (!members.has(userId)) continue;
    const nextMembers = new Map(members);
    nextMembers.delete(userId);
    summary.teamMemberships += 1;
    store.setTeamMembers(teamId, nextMembers);
    const team = store.getTeam(teamId);
    if (team) store.setTeam({ ...team, members: nextMembers.size });
  }

  for (const room of store.allRooms()) {
    const trustedApproverUserIds = room.trustedApproverUserIds.filter((candidate) => candidate !== userId);
    if (room.deletedAt && room.hostUserId === userId) {
      const { hostUserId: _hostUserId, activeHostDeviceId: _activeHostDeviceId, ...withoutHostIdentity } = room;
      store.setRoom({
        ...withoutHostIdentity,
        host: "Deleted user",
        hostStatus: "offline",
        trustedApproverUserIds
      });
    } else if (trustedApproverUserIds.length !== room.trustedApproverUserIds.length) {
      store.setRoom({ ...room, trustedApproverUserIds });
    }
  }

  const removedInviteIds = new Set<string>();
  summary.inviteArtifacts += deleteMatching(store.invites, (inviteId, invite) => {
    if (invite.creatorUserId !== userId && invite.approvedUserId !== userId) return false;
    removedInviteIds.add(inviteId);
    return true;
  });
  summary.inviteArtifacts += deleteMatching(
    store.inviteRequests,
    (_id, request) => request.requesterUserId === userId || removedInviteIds.has(request.inviteId)
  );
  summary.inviteArtifacts += deleteMatching(
    store.inviteResponses,
    (_id, response) =>
      response.requesterUserId === userId ||
      response.responseBinding.hostUserId === userId ||
      removedInviteIds.has(response.inviteId)
  );
  summary.inviteArtifacts += deleteMatching(
    store.inviteAckReceipts,
    (_id, receipt) => receipt.requesterUserId === userId || removedInviteIds.has(receipt.inviteId)
  );

  return summary;
}

function deleteMatching<Key, Value>(map: Map<Key, Value>, predicate: (key: Key, value: Value) => boolean): number {
  let deleted = 0;
  for (const [key, value] of map) {
    if (!predicate(key, value)) continue;
    if (map.delete(key)) deleted += 1;
  }
  return deleted;
}

function snapshotAccountDeletionState(
  store: RelayStore,
  userId: string,
  touched?: AccountDeletionStateSnapshot
): AccountDeletionStateSnapshot {
  const sessionIds = new Set(
    Array.from(store.authSessions, ([sessionId, session]) => (session.user.id === userId ? sessionId : null)).filter(
      (sessionId): sessionId is string => sessionId !== null
    )
  );
  const inviteIds = new Set(
    Array.from(store.invites, ([inviteId, invite]) =>
      invite.creatorUserId === userId || invite.approvedUserId === userId ? inviteId : null
    ).filter((inviteId): inviteId is string => inviteId !== null)
  );
  const select = <Value>(
    source: Map<string, Value>,
    predicate: (key: string, value: Value) => boolean
  ): Map<string, Value> =>
    touched
      ? entriesAtKeys(source, touchedMapKeys(touched, source, store))
      : new Map(Array.from(source).filter(([key, value]) => predicate(key, value)));
  return {
    authSessions: select(store.authSessions, (_key, session) => session.user.id === userId),
    deviceSessions: select(store.deviceSessions, (_key, session) => session.userId === userId),
    devices: select(store.devices, (_key, device) => device.userId === userId),
    keyPackages: select(store.keyPackages, (_key, keyPackage) => keyPackage.userId === userId),
    rooms: select(
      store.rooms,
      (_key, room) =>
        (Boolean(room.deletedAt) && room.hostUserId === userId) || room.trustedApproverUserIds.includes(userId)
    ),
    invites: select(
      store.invites,
      (_key, invite) => invite.creatorUserId === userId || invite.approvedUserId === userId
    ),
    inviteRequests: select(
      store.inviteRequests,
      (_key, request) => request.requesterUserId === userId || inviteIds.has(request.inviteId)
    ),
    inviteResponses: select(
      store.inviteResponses,
      (_key, response) =>
        response.requesterUserId === userId ||
        response.responseBinding.hostUserId === userId ||
        inviteIds.has(response.inviteId)
    ),
    inviteAckReceipts: select(
      store.inviteAckReceipts,
      (_key, receipt) => receipt.requesterUserId === userId || inviteIds.has(receipt.inviteId)
    ),
    teamMembers: touched
      ? entriesAtKeys(store.teamMembers, touched.teamMembers.keys(), (members) => new Map(members))
      : new Map(
          Array.from(store.teamMembers)
            .filter(([, members]) => members.has(userId))
            .map(([teamId, members]) => [teamId, new Map(members)])
        ),
    dailyTeamCreationCounts: select(
      store.dailyTeamCreationCounts,
      (key) => key === `daily_user_team_creations:${userId}`
    ),
    dailyRoomCreationCounts: select(
      store.dailyRoomCreationCounts,
      (key) => key === `daily_user_room_creations:${userId}`
    ),
    attachmentBlobUploadByteCounts: select(store.attachmentBlobUploadByteCounts, (key) => key === userId),
    rateLimitStore: select(store.rateLimitStore, (key) =>
      Array.from(sessionIds).some((sessionId) => key.endsWith(`:session:${sessionId}`))
    ),
    deviceChallenges: select(store.deviceChallenges, (_key, challenge) => challenge.userId === userId)
  };
}

function touchedMapKeys(
  touched: AccountDeletionStateSnapshot,
  source: Map<string, unknown>,
  store: RelayStore
): Iterable<string> {
  if (source === store.authSessions) return touched.authSessions.keys();
  if (source === store.deviceSessions) return touched.deviceSessions.keys();
  if (source === store.devices) return touched.devices.keys();
  if (source === store.keyPackages) return touched.keyPackages.keys();
  if (source === store.rooms) return touched.rooms.keys();
  if (source === store.invites) return touched.invites.keys();
  if (source === store.inviteRequests) return touched.inviteRequests.keys();
  if (source === store.inviteResponses) return touched.inviteResponses.keys();
  if (source === store.inviteAckReceipts) return touched.inviteAckReceipts.keys();
  if (source === store.dailyTeamCreationCounts) return touched.dailyTeamCreationCounts.keys();
  if (source === store.dailyRoomCreationCounts) return touched.dailyRoomCreationCounts.keys();
  if (source === store.attachmentBlobUploadByteCounts) return touched.attachmentBlobUploadByteCounts.keys();
  if (source === store.rateLimitStore) return touched.rateLimitStore.keys();
  return touched.deviceChallenges.keys();
}

function entriesAtKeys<Value>(
  source: Map<string, Value>,
  keys: Iterable<string>,
  clone: (value: Value) => Value = (value) => value
): Map<string, Value> {
  const selected = new Map<string, Value>();
  for (const key of keys) {
    const value = source.get(key);
    if (value !== undefined) selected.set(key, clone(value));
  }
  return selected;
}

function restoreAccountDeletionState(
  store: RelayStore,
  before: AccountDeletionStateSnapshot,
  after: AccountDeletionStateSnapshot
) {
  restoreChangedEntries(store.authSessions, before.authSessions, after.authSessions);
  restoreChangedEntries(store.deviceSessions, before.deviceSessions, after.deviceSessions);
  restoreChangedEntries(store.devices, before.devices, after.devices);
  restoreChangedEntries(store.keyPackages, before.keyPackages, after.keyPackages);
  restoreChangedEntries(store.rooms, before.rooms, after.rooms);
  restoreChangedEntries(store.invites, before.invites, after.invites);
  restoreChangedEntries(store.inviteRequests, before.inviteRequests, after.inviteRequests);
  restoreChangedEntries(store.inviteResponses, before.inviteResponses, after.inviteResponses);
  restoreChangedEntries(store.inviteAckReceipts, before.inviteAckReceipts, after.inviteAckReceipts);
  restoreDeletedTeamMemberships(store, before.teamMembers, after.teamMembers);
  restoreChangedEntries(store.dailyTeamCreationCounts, before.dailyTeamCreationCounts, after.dailyTeamCreationCounts);
  restoreChangedEntries(store.dailyRoomCreationCounts, before.dailyRoomCreationCounts, after.dailyRoomCreationCounts);
  restoreChangedEntries(
    store.attachmentBlobUploadByteCounts,
    before.attachmentBlobUploadByteCounts,
    after.attachmentBlobUploadByteCounts
  );
  restoreChangedEntries(store.rateLimitStore, before.rateLimitStore, after.rateLimitStore);
  restoreChangedEntries(store.deviceChallenges, before.deviceChallenges, after.deviceChallenges);
}

function restoreChangedEntries<Key, Value>(
  target: Map<Key, Value>,
  before: Map<Key, Value>,
  after: Map<Key, Value>,
  valuesEqual: (left: Value, right: Value) => boolean = Object.is
) {
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const beforeHas = before.has(key);
    const afterHas = after.has(key);
    const changed = beforeHas !== afterHas || (beforeHas && !valuesEqual(before.get(key)!, after.get(key)!));
    if (!changed) continue;
    const currentHas = target.has(key);
    const stillAtDeletedState =
      currentHas === afterHas && (!afterHas || valuesEqual(target.get(key)!, after.get(key)!));
    if (!stillAtDeletedState) continue;
    if (beforeHas) target.set(key, before.get(key)!);
    else target.delete(key);
  }
}

function restoreDeletedTeamMemberships(
  store: RelayStore,
  before: Map<string, Map<string, TeamMemberRecord>>,
  after: Map<string, Map<string, TeamMemberRecord>>
) {
  for (const [teamId, previousMembers] of before) {
    const deletedUserIds = Array.from(previousMembers.keys()).filter((userId) => !after.get(teamId)?.has(userId));
    if (deletedUserIds.length === 0) continue;
    const currentMembers = new Map(store.getTeamMembers(teamId) ?? []);
    let changed = false;
    for (const userId of deletedUserIds) {
      if (currentMembers.has(userId)) continue;
      currentMembers.set(userId, previousMembers.get(userId)!);
      changed = true;
    }
    if (!changed) continue;
    store.setTeamMembers(teamId, currentMembers);
    const team = store.getTeam(teamId);
    if (team) store.setTeam({ ...team, members: currentMembers.size });
  }
}
