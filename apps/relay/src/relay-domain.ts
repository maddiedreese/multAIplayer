import {
  isRecord,
  maxAuthSessionIdChars,
  maxCodexModelChars,
  maxHostNameChars,
  maxRoomProjectPathChars,
  maxUserIdChars,
  type InviteRecord,
  type MlsRelayMessage,
  type RoomRecord,
  type TeamMemberRecord,
  type TeamRecord,
  type TeamRole
} from "@multaiplayer/protocol";
import {
  normalizeCodexModel as normalizeCodexModelWithLimit,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRelayId,
  normalizeRoomProjectPath as normalizeRoomProjectPathWithLimit,
  pruneMlsBacklog as pruneMlsBacklogWithLimits
} from "./limits.js";
import type { AuthSession, ClientSession, RelayStore, RoomKey } from "./state.js";

export function roomKey(teamId: string, roomId: string): RoomKey {
  return `${teamId}:${roomId}`;
}

export function isActiveTeam(store: Pick<RelayStore, "getTeam">, teamId: string): boolean {
  const team = store.getTeam(teamId);
  return Boolean(team && !team.archivedAt && !team.deletedAt);
}

export function isActiveRoom(store: Pick<RelayStore, "getTeam" | "getRoom">, teamId: string, roomId: string): boolean {
  const room = store.getRoom(roomId);
  return isActiveTeam(store, teamId) && Boolean(room && room.teamId === teamId && !room.archivedAt && !room.deletedAt);
}

export function isActiveInviteTarget(store: RelayStore, invite: InviteRecord | undefined): boolean {
  return Boolean(invite && isActiveRoom(store, invite.teamId, invite.roomId));
}

export function normalizeAuthSessionId(value: unknown): string {
  return normalizeRelayId(value, maxAuthSessionIdChars) ?? "";
}

export function displayNameForUser(user: AuthSession["user"]): string {
  return user.name?.trim() || user.login;
}

export function isRoomHost(room: RoomRecord, requester: { id: string; name: string }): boolean {
  if (!requester.id && !requester.name) return false;
  if (room.hostStatus !== "active") return false;
  if (room.hostUserId) return room.hostUserId === requester.id;
  return room.host === requester.name;
}

export function normalizeRoomProjectPath(value: unknown): string | null {
  return normalizeRoomProjectPathWithLimit(value, maxRoomProjectPathChars);
}

export function normalizeCodexModel(value: unknown): string | null {
  return normalizeCodexModelWithLimit(value, maxCodexModelChars);
}

export function canPublishMlsMessage(session: ClientSession, message: MlsRelayMessage): boolean {
  return (
    session.teamId === message.teamId &&
    session.roomId === message.roomId &&
    session.userId === message.senderUserId &&
    session.deviceId === message.senderDeviceId
  );
}

export function createRequesterFromRequest(getAuthSession: (sessionId: unknown) => AuthSession | null) {
  return (body: unknown, sessionId: unknown): { id: string; name: string } => {
    const session = getAuthSession(sessionId);
    if (session) {
      return {
        id: session.user.id,
        name: normalizeMetadataText(displayNameForUser(session.user), maxHostNameChars) ?? ""
      };
    }
    const requestBody = isRecord(body) ? body : {};
    return {
      id: normalizeOptionalMetadataText(requestBody.requesterUserId, maxUserIdChars) ?? "",
      name: normalizeOptionalMetadataText(requestBody.requesterName, maxHostNameChars) ?? ""
    };
  };
}

export function createTeamMutationHelpers(options: {
  store: RelayStore;
  scheduleStoreSave: () => void;
  broadcastWorkspaceUpdated: (team: TeamRecord) => void;
}) {
  function revokeTeamInvites(teamId: string) {
    if (revokeTeamInviteArtifacts(options.store, teamId)) options.scheduleStoreSave();
  }

  function addTeamMember(teamId: string, userId: string, role: TeamRole = "member") {
    if (!userId) return;
    const team = options.store.getTeam(teamId);
    if (!team) return;
    const members = options.store.getTeamMembers(teamId) ?? new Map<string, TeamMemberRecord>();
    if (members.has(userId)) return;
    members.set(userId, { teamId, userId, role, joinedAt: new Date().toISOString() });
    options.store.setTeamMembers(teamId, members);
    const updated: TeamRecord = { ...team, members: members.size };
    options.store.setTeam(updated);
    options.scheduleStoreSave();
    options.broadcastWorkspaceUpdated(updated);
  }

  return { addTeamMember, revokeTeamInvites };
}

export function revokeRoomInvites(store: RelayStore, teamId: string, roomId: string): boolean {
  return revokeInviteArtifactsWhere(store, (invite) => invite.teamId === teamId && invite.roomId === roomId);
}

export function revokeTeamInviteArtifacts(store: RelayStore, teamId: string): boolean {
  return revokeInviteArtifactsWhere(store, (invite) => invite.teamId === teamId);
}

function revokeInviteArtifactsWhere(store: RelayStore, matches: (invite: InviteRecord) => boolean): boolean {
  const revokedInviteIds = new Set<string>();
  for (const [inviteId, invite] of store.invites) {
    if (!matches(invite)) continue;
    store.invites.delete(inviteId);
    revokedInviteIds.add(inviteId);
  }
  for (const [requestId, request] of store.inviteRequests) {
    if (revokedInviteIds.has(request.inviteId)) store.inviteRequests.delete(requestId);
  }
  for (const [requestId, response] of store.inviteResponses) {
    if (revokedInviteIds.has(response.inviteId)) store.inviteResponses.delete(requestId);
  }
  for (const [requestId, receipt] of store.inviteAckReceipts) {
    if (revokedInviteIds.has(receipt.inviteId)) store.inviteAckReceipts.delete(requestId);
  }
  return revokedInviteIds.size > 0;
}

export function createMlsBacklogPruner(options: {
  mlsBacklogLimit: number;
  mlsBacklogRetentionDays: number;
  mlsMessageMaxBytes: number;
  maxMlsMessageChars: number;
  maxDeviceIdChars: number;
  maxEnvelopeIdChars: number;
  maxPublicKeyJwkChars: number;
  maxUserIdChars: number;
}) {
  return (messages: MlsRelayMessage[]): MlsRelayMessage[] => pruneMlsBacklogWithLimits(messages, options);
}
