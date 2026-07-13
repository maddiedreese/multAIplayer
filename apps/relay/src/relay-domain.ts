import {
  isRecord,
  maxAuthSessionIdChars,
  maxCodexModelChars,
  maxHostNameChars,
  maxRoomProjectPathChars,
  maxUserIdChars,
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
    let revoked = false;
    for (const [inviteId, invite] of options.store.invites.entries()) {
      if (invite.teamId !== teamId) continue;
      options.store.invites.delete(inviteId);
      for (const [requestId, request] of options.store.inviteRequests) {
        if (request.inviteId === inviteId) options.store.inviteRequests.delete(requestId);
      }
      for (const [requestId, response] of options.store.inviteResponses) {
        if (response.inviteId === inviteId) options.store.inviteResponses.delete(requestId);
      }
      revoked = true;
    }
    if (revoked) options.scheduleStoreSave();
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
