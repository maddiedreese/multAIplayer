import type { WebSocket } from "ws";
import type { TeamRole } from "@multaiplayer/protocol";
import type { ClientSession, PresenceRecord, RelayStore, RoomKey } from "../state.js";

interface CreateRelayRoomSocketManagerOptions {
  store: RelayStore;
  roomSockets: Map<RoomKey, Set<WebSocket>>;
  teamSockets: Map<string, Set<WebSocket>>;
  workspaceSockets: Set<WebSocket>;
  roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  sessions: Map<WebSocket, ClientSession>;
  mutationsRequireAuth: boolean;
  roomKey: (teamId: string, roomId: string) => RoomKey;
  canAccessRoom: (teamId: string, roomId: string, userId: string) => boolean;
  isTeamMember: (teamId: string, userId: string) => boolean;
  addTeamMember: (teamId: string, userId: string, role?: TeamRole) => void;
  scheduleStoreSave: () => void;
  send: (
    socket: WebSocket,
    message: { type: "error"; message: string; code?: "membership_removed"; teamId?: string; roomId?: string }
  ) => void;
  broadcast: (key: RoomKey, message: { type: "presence"; status: "online" | "offline" } & PresenceRecord) => void;
}

export function createRelayRoomSocketManager({
  store,
  roomSockets,
  teamSockets,
  workspaceSockets,
  roomPresence,
  sessions,
  mutationsRequireAuth,
  roomKey,
  canAccessRoom,
  isTeamMember,
  addTeamMember,
  scheduleStoreSave,
  send,
  broadcast
}: CreateRelayRoomSocketManagerOptions) {
  function joinRoom(session: ClientSession, teamId: string, roomId: string, userId: string, deviceId: string) {
    leaveRoom(session);
    session.teamId = teamId;
    session.roomId = roomId;
    session.userId = userId;
    session.deviceId = deviceId;
    const key = roomKey(teamId, roomId);
    const sockets = roomSockets.get(key) ?? new Set<WebSocket>();
    sockets.add(session.socket);
    roomSockets.set(key, sockets);
  }

  function subscribeTeam(session: ClientSession, teamId: string) {
    session.subscribedTeamIds.add(teamId);
    const sockets = teamSockets.get(teamId) ?? new Set<WebSocket>();
    sockets.add(session.socket);
    teamSockets.set(teamId, sockets);
  }

  function subscribeWorkspace(session: ClientSession) {
    session.workspaceSubscribed = true;
    workspaceSockets.add(session.socket);
  }

  function isKnownRoom(teamId: string, roomId: string): boolean {
    const team = store.getTeam(teamId);
    const room = store.getRoom(roomId);
    return Boolean(team && !team.deletedAt && room && !room.deletedAt && room.teamId === teamId);
  }

  function canJoinRoom(
    session: ClientSession,
    teamId: string,
    roomId: string,
    userId: string,
    deviceId: string,
    inviteId?: string
  ): boolean {
    if (!mutationsRequireAuth) return true;
    if (!session.authSession || session.authSession.user.id !== userId) return false;
    if (canAccessRoom(teamId, roomId, userId)) return true;
    const invite = inviteId ? approvedInviteForAdmission(inviteId, teamId, roomId, userId, deviceId) : null;
    if (!invite) return false;
    // Persist membership before consuming the one-shot invite. If the second
    // write fails, restart reloads an admitted member plus a still-usable
    // capability instead of a deleted capability with no membership.
    addTeamMember(teamId, userId);
    store.deleteInvite(invite.id);
    try {
      scheduleStoreSave();
    } catch (error) {
      store.setInvite(invite);
      throw error;
    }
    return true;
  }

  function canAuthenticateJoinIdentity(session: ClientSession, userId: string): boolean {
    return !mutationsRequireAuth || session.authSession?.user.id === userId;
  }

  function canSubscribeTeam(session: ClientSession, teamId: string, userId: string): boolean {
    if (!mutationsRequireAuth) return true;
    return Boolean(session.authSession && session.authSession.user.id === userId && isTeamMember(teamId, userId));
  }

  function canSubscribeWorkspace(session: ClientSession, userId: string): boolean {
    if (!mutationsRequireAuth) return true;
    return Boolean(session.authSession && session.authSession.user.id === userId);
  }

  function leaveRoom(session: ClientSession) {
    if (!session.teamId || !session.roomId) return;
    const key = roomKey(session.teamId, session.roomId);
    if (session.deviceId) {
      const roster = roomPresence.get(key);
      const presence = roster?.get(session.deviceId);
      if (presence) {
        roster?.delete(session.deviceId);
        if (roster?.size === 0) roomPresence.delete(key);
        broadcast(key, { type: "presence", ...presence, status: "offline" });
      }
    }
    const sockets = roomSockets.get(key);
    sockets?.delete(session.socket);
    if (sockets?.size === 0) roomSockets.delete(key);
  }

  function leaveTeams(session: ClientSession) {
    for (const teamId of session.subscribedTeamIds) {
      const sockets = teamSockets.get(teamId);
      sockets?.delete(session.socket);
      if (sockets?.size === 0) teamSockets.delete(teamId);
    }
    session.subscribedTeamIds.clear();
  }

  function leaveWorkspace(session: ClientSession) {
    if (!session.workspaceSubscribed) return;
    workspaceSockets.delete(session.socket);
    session.workspaceSubscribed = false;
  }

  function revokeTeamMemberSessions(teamId: string, userId: string) {
    for (const session of Array.from(sessions.values())) {
      if (session.authSession?.user.id !== userId && session.userId !== userId) continue;

      const joinedRemovedTeam = session.teamId === teamId;
      const subscribedRemovedTeam = session.subscribedTeamIds.has(teamId);
      const workspaceSubscribed = session.workspaceSubscribed;
      if (!joinedRemovedTeam && !subscribedRemovedTeam && !workspaceSubscribed) continue;

      send(session.socket, {
        type: "error",
        message: "Your team membership was removed. Rejoin with a fresh invite before continuing.",
        code: "membership_removed",
        teamId
      });
      leaveRoom(session);
      leaveTeams(session);
      leaveWorkspace(session);
      session.socket.close(1008, "Team membership removed");
    }
  }

  function revokeUserPresence(userId: string) {
    for (const [key, roster] of roomPresence) {
      for (const [deviceId, presence] of roster) {
        if (presence.userId !== userId) continue;
        roster.delete(deviceId);
        broadcast(key, { type: "presence", ...presence, status: "offline" });
      }
      if (roster.size === 0) roomPresence.delete(key);
    }
  }

  function revokeUserSessions(userId: string, message: string, closeReason: string) {
    for (const session of Array.from(sessions.values())) {
      if (session.authSession?.user.id !== userId && session.userId !== userId) continue;
      send(session.socket, { type: "error", message });
      leaveRoom(session);
      leaveTeams(session);
      leaveWorkspace(session);
      sessions.delete(session.socket);
      session.socket.close(1008, closeReason);
    }
    revokeUserPresence(userId);
  }

  function approvedInviteForAdmission(
    inviteId: string,
    teamId: string,
    roomId: string,
    userId: string,
    deviceId: string
  ): ReturnType<RelayStore["getInvite"]> | null {
    const invite = store.getInvite(inviteId);
    if (!invite || invite.teamId !== teamId || invite.roomId !== roomId) return null;
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      store.deleteInvite(invite.id);
      scheduleStoreSave();
      return null;
    }
    if (invite.approvedUserId !== userId || invite.approvedDeviceId !== deviceId) return null;
    const durableWelcome = Array.from(store.inviteResponses.values()).find(
      (response) =>
        response.inviteId === invite.id &&
        response.requesterUserId === userId &&
        response.requesterDeviceId === deviceId &&
        response.keyPackageHash === invite.keyPackageHash &&
        response.status === "approved" &&
        Boolean(response.welcome)
    );
    return durableWelcome ? invite : null;
  }

  return {
    joinRoom,
    subscribeTeam,
    subscribeWorkspace,
    isKnownRoom,
    canAuthenticateJoinIdentity,
    canJoinRoom,
    canSubscribeTeam,
    canSubscribeWorkspace,
    leaveRoom,
    leaveTeams,
    leaveWorkspace,
    revokeTeamMemberSessions,
    revokeUserPresence,
    revokeUserSessions
  };
}
